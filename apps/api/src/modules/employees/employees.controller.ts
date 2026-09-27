import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { EmploymentStatus } from '@prisma/client';
import { z } from 'zod';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../authorization/access.service';
import { toPermissions } from '../authorization/permissions';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { SessionService } from '../auth/session.service';

const patchBody = z
  .object({
    roleAssignments: z
      .array(z.object({ roleId: z.string().uuid(), orgUnitId: z.string().uuid().nullable() }).strict())
      .min(1)
      .max(20)
      .optional(),
    status: z.nativeEnum(EmploymentStatus).optional(),
    orgUnitId: z.string().uuid().nullable().optional(),
    levelId: z.string().uuid().nullable().optional(),
    email: z.string().email().max(200).nullable().optional(),
  })
  .strict();

@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /** Employees visible in the caller's report scope (for report filters / manager views). */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const scope = await this.access.reportScope(user);
    const admin = user.permissions.includes('employee.admin');
    const rows = await this.prisma.employee.findMany({
      where: admin ? {} : { id: this.access.employeeFilter(scope), status: EmploymentStatus.ACTIVE },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        nickname: true,
        status: true,
        orgUnit: { select: { id: true, name: true } },
        level: { select: { id: true, code: true, name: true } },
        ...(admin
          ? {
              email: true,
              roleAssignments: {
                select: { roleId: true, orgUnitId: true, role: { select: { key: true, name: true } }, orgUnit: { select: { name: true } } },
              },
            }
          : {}),
      },
    });
    return rows;
  }

  @Get('options')
  @RequirePermission('employee.admin')
  async options() {
    const [orgUnits, levels, roles] = await Promise.all([
      this.prisma.orgUnit.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, parentId: true, managerId: true } }),
      this.prisma.employeeLevel.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], select: { id: true, key: true, name: true, description: true, permissions: true } }),
    ]);
    return { orgUnits, levels, roles };
  }

  @Patch(':id')
  @RequirePermission('employee.admin')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(patchBody)) body: z.infer<typeof patchBody>, @Req() req: AppRequest) {
    if (id === user.id && (body.roleAssignments || body.status)) {
      throw new DomainError('SELF_ESCALATION', 'ไม่สามารถแก้ไขสิทธิ์หรือสถานะของตนเองได้', 403);
    }
    if (body.roleAssignments) {
      // Privilege-escalation guard: you can only hand out permissions you hold yourself.
      const roles = await this.prisma.role.findMany({ where: { id: { in: body.roleAssignments.map((a) => a.roleId) } } });
      if (roles.length !== new Set(body.roleAssignments.map((a) => a.roleId)).size) throw notFound('บทบาท');
      const excess = roles.flatMap((r) => toPermissions(r.permissions)).filter((p) => !user.permissions.includes(p));
      if (excess.length) {
        throw new DomainError('FORBIDDEN', 'ไม่สามารถมอบบทบาทที่มีสิทธิ์มากกว่าที่คุณมีได้', 403, { permissions: [...new Set(excess)] });
      }
    }
    const { roleAssignments, ...fields } = body;
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.employee.findUnique({ where: { id }, include: { roleAssignments: { select: { roleId: true, orgUnitId: true } } } });
      if (!before) throw notFound('พนักงาน');
      const after = await tx.employee.update({ where: { id }, data: fields });
      if (roleAssignments) {
        await tx.roleAssignment.deleteMany({ where: { employeeId: id } });
        const unique = [...new Map(roleAssignments.map((a) => [`${a.roleId}|${a.orgUnitId}`, a])).values()];
        await tx.roleAssignment.createMany({ data: unique.map((a) => ({ employeeId: id, roleId: a.roleId, orgUnitId: a.orgUnitId })) });
      }
      await this.audit.record(
        {
          action: 'employee.update',
          resourceType: 'employee',
          resourceId: id,
          before: { roleAssignments: before.roleAssignments, status: before.status, orgUnitId: before.orgUnitId, levelId: before.levelId, email: before.email },
          after: body,
        },
        req,
        tx,
      );
      return after;
    });
    // Deactivation takes effect immediately (role changes already do: permissions are resolved per request).
    if (body.status === EmploymentStatus.INACTIVE) await this.sessions.revokeAllFor(id);
    return { id: updated.id, status: updated.status };
  }
}
