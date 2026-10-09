import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Prisma, WorkCategoryType } from '@prisma/client';
import { z } from 'zod';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ENGAGEMENT_INCLUDE, engagementDto } from '../time-report/time-report.service';

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});
const customerBody = z
  .object({
    // TRCLOUD codes may be Thai (e.g. ก001): any letters / digits / - _ . / without spaces.
    code: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{M}\p{N}_./-]+$/u, 'รหัสใช้ได้เฉพาะตัวอักษร ตัวเลข - _ . / (ไม่มีช่องว่าง)'),
    name: z.string().trim().min(1).max(200),
    taxId: z.string().trim().regex(/^\d{13}$/, 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก').nullish(),
    address: z.string().trim().max(500).nullish(),
    accountOwnerId: z.string().uuid().nullish(),
    isActive: z.boolean().default(true),
  })
  .strict();
const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
const engagementBody = z.object({ isActive: z.boolean() }).strict();
/** An "Activity" (legacy job_table): a service/work type, optionally under a group (one level deep). */
const activityBody = z
  .object({
    name: z.string().trim().min(1).max(150),
    type: z.nativeEnum(WorkCategoryType),
    parentId: z.string().uuid().nullable(),
    isBillable: z.boolean(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .strict();

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Minimal list for pickers. Full customer details (tax id, address) only for catalog admins. */
  @Get('customers')
  async customers(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const admin = user.permissions.includes('catalog.write');
    const where: Prisma.CustomerWhereInput = {
      ...(admin && q.includeInactive === 'true' ? {} : { isActive: true }),
      ...(q.search
        ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    return this.prisma.customer.findMany({
      where,
      orderBy: { code: 'asc' },
      take: 1000,
      select: admin
        ? { id: true, code: true, name: true, taxId: true, address: true, isActive: true, trcloudLinks: { select: { company: true, contactCode: true } }, accountOwner: { select: { id: true, fullName: true } } }
        : { id: true, code: true, name: true, isActive: true },
    });
  }

  @Get('customers/:id/engagements')
  async engagements(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const all = user.permissions.includes('catalog.write') && q.includeInactive === 'true';
    const rows = await this.prisma.engagement.findMany({
      where: { customerId: id, ...(all ? {} : { isActive: true, workCategory: { isActive: true } }) },
      include: { workCategory: { include: { parent: { select: { name: true } } } } },
    });
    return rows
      .map((e) => ({
        id: e.id,
        isActive: e.isActive,
        code: e.code,
        budgetMinutes: e.budgetMinutes,
        workCategory: { id: e.workCategory.id, name: e.workCategory.name, type: e.workCategory.type, group: e.workCategory.parent?.name ?? null },
      }))
      .sort((a, b) => a.workCategory.name.localeCompare(b.workCategory.name, 'th'));
  }

  /**
   * One-step task picker: search active (customer × work category) pairs.
   * Every whitespace-separated token must match the customer code, customer name or task name,
   * e.g. "A001 ปิดบัญชี".
   */
  @Get('engagements/search')
  async searchEngagements(@Query(new ZodPipe(searchQuery)) q: z.infer<typeof searchQuery>) {
    const tokens = (q.q ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
    const rows = await this.prisma.engagement.findMany({
      where: {
        isActive: true,
        customer: { isActive: true },
        workCategory: { isActive: true },
        AND: tokens.map((t) => ({
          OR: [
            { customer: { code: { startsWith: t, mode: 'insensitive' as const } } },
            { customer: { name: { contains: t, mode: 'insensitive' as const } } },
            { workCategory: { name: { contains: t, mode: 'insensitive' as const } } },
            { workCategory: { parent: { name: { contains: t, mode: 'insensitive' as const } } } },
            { code: { startsWith: t, mode: 'insensitive' as const } },
          ],
        })),
      },
      include: ENGAGEMENT_INCLUDE,
      orderBy: [{ customer: { code: 'asc' } }, { workCategory: { name: 'asc' } }],
      take: q.limit,
    });
    return rows.map(engagementDto);
  }

  @Get('work-categories')
  async workCategories(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.workCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true, engagements: true } },
      },
    });
    const admin = user.permissions.includes('catalog.write');
    return rows.map(({ _count, legacyId, ...c }) => ({
      ...c,
      childCount: _count.children,
      // Usage counts help admins decide whether deactivating is safe.
      ...(admin ? { customerCount: _count.engagements, legacyId } : {}),
    }));
  }

  @Post('work-categories')
  @RequirePermission('catalog.write')
  async createActivity(@Body(new ZodPipe(activityBody)) body: z.infer<typeof activityBody>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertValidParent(tx, null, body.parentId);
      const c = await tx.workCategory.create({ data: body });
      await this.audit.record({ action: 'activity.create', resourceType: 'work_category', resourceId: c.id, after: body }, req, tx);
      return c;
    });
  }

  @Put('work-categories/:id')
  @RequirePermission('catalog.write')
  async updateActivity(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(activityBody)) body: z.infer<typeof activityBody>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.workCategory.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
      if (!before) throw notFound('Activity');
      await this.assertValidParent(tx, id, body.parentId);
      if (body.parentId && before._count.children > 0) {
        throw new DomainError('INVALID_PARENT', 'กลุ่มที่มี Activity ย่อยอยู่ ไม่สามารถย้ายไปอยู่ใต้กลุ่มอื่นได้', 422);
      }
      const c = await tx.workCategory.update({ where: { id }, data: body });
      await this.audit.record({ action: 'activity.update', resourceType: 'work_category', resourceId: id, before, after: body }, req, tx);
      return c;
    });
  }

  /** Groups are one level deep: the parent must exist, be a top-level item, and not be the item itself. */
  private async assertValidParent(tx: Prisma.TransactionClient, id: string | null, parentId: string | null) {
    if (!parentId) return;
    if (parentId === id) throw new DomainError('INVALID_PARENT', 'Activity เป็นกลุ่มของตัวเองไม่ได้', 422);
    const parent = await tx.workCategory.findUnique({ where: { id: parentId } });
    if (!parent) throw notFound('กลุ่ม');
    if (parent.parentId) throw new DomainError('INVALID_PARENT', 'เลือกได้เฉพาะกลุ่มระดับบนสุด', 422);
  }

  @Post('customers')
  @RequirePermission('catalog.write')
  async createCustomer(@Body(new ZodPipe(customerBody)) body: z.infer<typeof customerBody>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.customer.findUnique({ where: { code: body.code } })) throw new DomainError('DUPLICATE', 'รหัสลูกค้านี้มีอยู่แล้ว', 409);
      const c = await tx.customer.create({ data: body });
      await this.audit.record({ action: 'customer.create', resourceType: 'customer', resourceId: c.id, after: body }, req, tx);
      return c;
    });
  }

  /** Changing the code is safe: foreign keys use the surrogate id (legacy updated the PK in 3 tables). */
  @Put('customers/:id')
  @RequirePermission('catalog.write')
  async updateCustomer(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(customerBody)) body: z.infer<typeof customerBody>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.customer.findUnique({ where: { id }, include: { trcloudLinks: { select: { company: true, contactCode: true } } } });
      if (!before) throw notFound('ลูกค้า');
      // A TRCLOUD customer's code, name, tax id, address and active state come from TRCLOUD (the sync would undo edits).
      const fromTrcloud = before.trcloudLinks.length > 0;
      const data = fromTrcloud ? { accountOwnerId: body.accountOwnerId } : body;
      if (!fromTrcloud) {
        const dup = await tx.customer.findUnique({ where: { code: body.code } });
        if (dup && dup.id !== id) throw new DomainError('DUPLICATE', 'รหัสลูกค้านี้มีอยู่แล้ว', 409);
      }
      const c = await tx.customer.update({ where: { id }, data });
      await this.audit.record({ action: 'customer.update', resourceType: 'customer', resourceId: id, before, after: data }, req, tx);
      return c;
    });
  }

  @Put('customers/:id/engagements/:workCategoryId')
  @RequirePermission('catalog.write')
  async setEngagement(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Param('workCategoryId', ParseUUIDPipe) workCategoryId: string,
    @Body(new ZodPipe(engagementBody)) body: z.infer<typeof engagementBody>,
    @Req() req: AppRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [customer, category] = await Promise.all([
        tx.customer.findUnique({ where: { id: customerId } }),
        tx.workCategory.findUnique({ where: { id: workCategoryId } }),
      ]);
      if (!customer || !category) throw notFound('ลูกค้าหรือประเภทงาน');
      // The ongoing (period-less) engagement; per-period engagements are managed separately once confirmed (docs/06).
      const existing = await tx.engagement.findFirst({ where: { customerId, workCategoryId, periodStart: null } });
      const e = existing
        ? await tx.engagement.update({ where: { id: existing.id }, data: { isActive: body.isActive } })
        : await tx.engagement.create({ data: { customerId, workCategoryId, isActive: body.isActive } });
      await this.audit.record({ action: 'engagement.set', resourceType: 'engagement', resourceId: e.id, after: { customerId, workCategoryId, ...body } }, req, tx);
      return e;
    });
  }
}
