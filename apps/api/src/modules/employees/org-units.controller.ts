import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { EmploymentStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { RequirePermission } from '../auth/decorators';

const createBody = z
  .object({
    name: z.string().trim().min(1, 'กรุณาระบุชื่อทีม').max(80),
    parentId: z.string().uuid().nullish(),
    managerId: z.string().uuid().nullish(),
  })
  .strict();
const patchBody = createBody.partial().strict();

type Tx = Prisma.TransactionClient;

/**
 * Teams (legacy team_table + subTeam_table, now one tree).
 * Legacy could add/rename teams and add/rename/move sub-teams; deleting was not possible.
 * Here an empty team can also be deleted. Moving a team changes which managers can see its members
 * in reports (scopes include sub-teams), so every change is audited.
 */
@Controller('org-units')
export class OrgUnitsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('employee.admin')
  async list() {
    const units = await this.prisma.orgUnit.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        parentId: true,
        manager: { select: { id: true, fullName: true, nickname: true } },
        _count: { select: { members: { where: { status: EmploymentStatus.ACTIVE } }, children: true, roleScopes: true, schedules: true, externalAccounts: true } },
      },
    });
    return units.map(({ _count, ...u }) => ({
      ...u,
      memberCount: _count.members,
      childCount: _count.children,
      usage: { roleScopes: _count.roleScopes, schedules: _count.schedules, accounts: _count.externalAccounts },
    }));
  }

  @Post()
  @RequirePermission('employee.admin')
  async create(@Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const parentId = body.parentId ?? null;
      if (parentId) await this.assertExists(tx, parentId);
      if (body.managerId) await this.assertActiveEmployee(tx, body.managerId);
      await this.assertUniqueName(tx, body.name, parentId);
      const unit = await tx.orgUnit.create({ data: { name: body.name, parentId, managerId: body.managerId ?? null } });
      await this.audit.record({ action: 'orgunit.create', resourceType: 'org_unit', resourceId: unit.id, after: body }, req, tx);
      return unit;
    });
  }

  @Patch(':id')
  @RequirePermission('employee.admin')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(patchBody)) body: z.infer<typeof patchBody>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.orgUnit.findUnique({ where: { id } });
      if (!before) throw notFound('ทีม');
      const parentId = body.parentId === undefined ? before.parentId : body.parentId;
      if (parentId && parentId !== before.parentId) await this.assertNoCycle(tx, id, parentId);
      if (body.managerId) await this.assertActiveEmployee(tx, body.managerId);
      const name = body.name ?? before.name;
      if (name !== before.name || parentId !== before.parentId) await this.assertUniqueName(tx, name, parentId, id);
      const unit = await tx.orgUnit.update({
        where: { id },
        data: { name, parentId, ...(body.managerId !== undefined ? { managerId: body.managerId } : {}) },
      });
      await this.audit.record(
        {
          action: 'orgunit.update',
          resourceType: 'org_unit',
          resourceId: id,
          before: { name: before.name, parentId: before.parentId, managerId: before.managerId },
          after: body,
        },
        req,
        tx,
      );
      return unit;
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('employee.admin')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const unit = await tx.orgUnit.findUnique({
        where: { id },
        include: { _count: { select: { members: true, children: true, roleScopes: true, schedules: true, externalAccounts: true } } },
      });
      if (!unit) throw notFound('ทีม');
      const c = unit._count;
      // Inactive members count too: their history still points at this team.
      const blockers = [
        c.members && `มีพนักงานในทีม ${c.members} คน (รวมผู้ที่ลาออก)`,
        c.children && `มีทีมย่อย ${c.children} ทีม`,
        c.roleScopes && `มีสิทธิ์ที่ผูกกับทีมนี้ ${c.roleScopes} รายการ`,
        c.schedules && `มีตารางเวลางานของทีม ${c.schedules} รายการ`,
        c.externalAccounts && `มีบัญชีระบบอื่นของทีม ${c.externalAccounts} บัญชี`,
      ].filter(Boolean) as string[];
      if (blockers.length) throw new DomainError('IN_USE', `ลบทีมไม่ได้: ${blockers.join(', ')}`, 409, { blockers });
      await tx.orgUnit.delete({ where: { id } });
      await this.audit.record({ action: 'orgunit.delete', resourceType: 'org_unit', resourceId: id, before: { name: unit.name, parentId: unit.parentId, managerId: unit.managerId } }, req, tx);
    });
  }

  private async assertExists(tx: Tx, id: string) {
    if (!(await tx.orgUnit.findUnique({ where: { id }, select: { id: true } }))) throw new DomainError('VALIDATION', 'ไม่พบทีมหลักที่เลือก', 422);
  }

  private async assertActiveEmployee(tx: Tx, id: string) {
    const e = await tx.employee.findUnique({ where: { id }, select: { status: true } });
    if (!e || e.status !== EmploymentStatus.ACTIVE) throw new DomainError('VALIDATION', 'หัวหน้าทีมต้องเป็นพนักงานที่ยังทำงานอยู่', 422);
  }

  /** Same name under the same parent is ambiguous in every dropdown (legacy checked duplicates too). */
  private async assertUniqueName(tx: Tx, name: string, parentId: string | null, exceptId?: string) {
    const clash = await tx.orgUnit.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, parentId, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new DomainError('DUPLICATE', 'มีทีมชื่อนี้อยู่แล้วในระดับเดียวกัน', 409);
  }

  /** A team cannot be moved under itself or under one of its own sub-teams. */
  private async assertNoCycle(tx: Tx, id: string, newParentId: string) {
    await this.assertExists(tx, newParentId);
    const units = await tx.orgUnit.findMany({ select: { id: true, parentId: true } });
    const parentOf = new Map(units.map((u) => [u.id, u.parentId]));
    for (let cur: string | null | undefined = newParentId, hops = 0; cur; cur = parentOf.get(cur), hops++) {
      if (cur === id || hops > units.length) throw new DomainError('VALIDATION', 'ย้ายทีมไปอยู่ใต้ตัวเองหรือทีมย่อยของตัวเองไม่ได้', 422);
    }
  }
}
