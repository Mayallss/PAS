import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { isPermission, Permission, PERMISSION_LABELS, PERMISSIONS } from '../authorization/permissions';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';

const roleBody = z
  .object({
    key: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,30}$/, 'รหัสบทบาทใช้ A-Z, 0-9 และ _ (ขึ้นต้นด้วยตัวอักษร)'),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).nullish(),
    permissions: z.array(z.string().refine(isPermission, 'ไม่รู้จักสิทธิ์นี้')).max(PERMISSIONS.length),
  })
  .strict();

/** Permissions the ADMIN role must always keep, so nobody can lock the organisation out of administration. */
const ADMIN_FLOOR: Permission[] = ['employee.admin', 'role.admin'];

@Controller('roles')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('employee.admin', 'role.admin')
  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { assignments: true } } },
    });
    return {
      catalogue: PERMISSIONS.map((key) => ({ key, label: PERMISSION_LABELS[key] })),
      roles: roles.map(({ _count, ...r }) => ({ ...r, assignmentCount: _count.assignments })),
    };
  }

  @Post()
  @RequirePermission('role.admin')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(roleBody)) body: z.infer<typeof roleBody>, @Req() req: AppRequest) {
    this.assertWithinOwn(user, body.permissions);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { ...body, permissions: [...new Set(body.permissions)].sort() } }).catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DomainError('DUPLICATE', 'มีรหัสบทบาทนี้แล้ว', 409);
        throw e;
      });
      await this.audit.record({ action: 'role.create', resourceType: 'role', resourceId: role.id, after: body }, req, tx);
      return role;
    });
  }

  @Put(':id')
  @RequirePermission('role.admin')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(roleBody)) body: z.infer<typeof roleBody>, @Req() req: AppRequest) {
    this.assertWithinOwn(user, body.permissions);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.role.findUnique({ where: { id } });
      if (!before) throw notFound('บทบาท');
      if (before.isSystem && body.key !== before.key) throw new DomainError('SYSTEM_ROLE', 'เปลี่ยนรหัสบทบาทของระบบไม่ได้', 422);
      if (before.key === 'ADMIN' && ADMIN_FLOOR.some((p) => !body.permissions.includes(p))) {
        throw new DomainError('SYSTEM_ROLE', 'บทบาท ADMIN ต้องมีสิทธิ์จัดการพนักงานและบทบาทเสมอ', 422);
      }
      const role = await tx.role.update({ where: { id }, data: { ...body, permissions: [...new Set(body.permissions)].sort() } });
      await this.audit.record({ action: 'role.update', resourceType: 'role', resourceId: id, before, after: body }, req, tx);
      return role;
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('role.admin')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { _count: { select: { assignments: true } } } });
      if (!role) throw notFound('บทบาท');
      if (role.isSystem) throw new DomainError('SYSTEM_ROLE', 'ลบบทบาทของระบบไม่ได้', 422);
      if (role._count.assignments) throw new DomainError('IN_USE', 'ยังมีพนักงานใช้บทบาทนี้อยู่', 409);
      await tx.role.delete({ where: { id } });
      await this.audit.record({ action: 'role.delete', resourceType: 'role', resourceId: id, before: role }, req, tx);
    });
  }

  /** A role admin cannot mint permissions they do not hold themselves. */
  private assertWithinOwn(user: AuthUser, permissions: string[]) {
    const excess = permissions.filter((p) => !user.permissions.includes(p as Permission));
    if (excess.length) throw new DomainError('FORBIDDEN', 'ไม่สามารถกำหนดสิทธิ์ที่คุณไม่มีได้', 403, { permissions: excess });
  }
}
