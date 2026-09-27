import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, 'รหัสใช้ได้เฉพาะ A-Z, 0-9, - และ _'),
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
        ? { id: true, code: true, name: true, taxId: true, address: true, isActive: true, accountOwner: { select: { id: true, fullName: true } } }
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
  workCategories() {
    return this.prisma.workCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { parent: { select: { id: true, name: true } } },
    });
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
      const before = await tx.customer.findUnique({ where: { id } });
      if (!before) throw notFound('ลูกค้า');
      const dup = await tx.customer.findUnique({ where: { code: body.code } });
      if (dup && dup.id !== id) throw new DomainError('DUPLICATE', 'รหัสลูกค้านี้มีอยู่แล้ว', 409);
      const c = await tx.customer.update({ where: { id }, data: body });
      await this.audit.record({ action: 'customer.update', resourceType: 'customer', resourceId: id, before, after: body }, req, tx);
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
