import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { EmploymentStatus, EmploymentType } from '@prisma/client';
import { z } from 'zod';
import { loadConfig } from '../../config';
import { isIsoDate, toDate, todayIn } from '../../common/dates';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../authorization/access.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { SessionService } from '../auth/session.service';
import { assertGrantable, mapEmployeeUnique, OnboardingService } from '../onboarding/onboarding.service';
import { setLevel } from './level-history';

const isoDate = z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD');
const roleAssignments = z.array(z.object({ roleId: z.string().uuid(), orgUnitId: z.string().uuid().nullable() }).strict()).min(1).max(20);
const profileFields = {
  employeeCode: z.string().trim().max(20).regex(/^[0-9A-Za-z-]*$/, 'รหัสพนักงานใช้ได้เฉพาะตัวเลข ตัวอักษร และ -').nullish(),
  fullNameEn: z.string().trim().max(200).nullish(),
  nickname: z.string().trim().max(60).nullish(),
  personalEmail: z.string().trim().email().max(200).nullish().or(z.literal('').transform(() => null)),
  employmentType: z.nativeEnum(EmploymentType).optional(),
  endDate: isoDate.nullish(),
  institution: z.string().trim().max(200).nullish(),
  departmentId: z.string().uuid().nullish(),
  orgUnitId: z.string().uuid().nullish(),
  levelId: z.string().uuid().nullish(),
};
const patchBody = z
  .object({
    ...profileFields,
    fullName: z.string().trim().min(1).max(200).optional(),
    startDate: isoDate.nullish(),
    roleAssignments: roleAssignments.optional(),
    /** When a level change takes effect (default today). Earlier periods are kept for cost reports. */
    levelEffectiveFrom: isoDate.optional(),
    status: z.nativeEnum(EmploymentStatus).optional(),
    email: z.string().email().max(200).nullable().optional(),
  })
  .strict();
/** New-employee wizard: profile + roles + (optional) first device, in one transaction. */
const createBody = z
  .object({
    ...profileFields,
    fullName: z.string().trim().min(1).max(200),
    employmentType: z.nativeEnum(EmploymentType),
    startDate: isoDate,
    email: z.string().trim().email().max(200).nullish().or(z.literal('').transform(() => null)),
    roleAssignments,
    device: z
      .object({ assetCode: z.string().trim().min(1).max(40), kind: z.enum(['PRIMARY', 'LOAN']), dueDate: isoDate.nullish() })
      .strict()
      .nullish(),
  })
  .strict();

@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly onboarding: OnboardingService,
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
              employeeCode: true,
              employmentType: true,
              roleAssignments: {
                select: { roleId: true, orgUnitId: true, role: { select: { key: true, name: true } }, orgUnit: { select: { name: true } } },
              },
            }
          : {}),
      },
    });
    return rows;
  }

  /**
   * Colleague picker (meeting invitees, HR filing leave): every active person's name and team — nothing else,
   * no e-mail or other personal data. Declared before ':id'.
   */
  @Get('directory')
  directory() {
    return this.prisma.employee.findMany({
      where: { status: EmploymentStatus.ACTIVE },
      orderBy: [{ nickname: 'asc' }, { fullName: 'asc' }],
      select: { id: true, fullName: true, nickname: true, orgUnit: { select: { name: true } } },
    });
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

  @Post()
  @RequirePermission('employee.admin')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>, @Req() req: AppRequest) {
    return this.onboarding.createEmployee(user, body, req);
  }

  /** Full profile: roles, accounts in other systems, devices, onboarding checklist. */
  @Get(':id')
  @RequirePermission('employee.admin', 'onboarding.manage')
  profile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.profile(id, user);
  }

  @Patch(':id')
  @RequirePermission('employee.admin')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(patchBody)) body: z.infer<typeof patchBody>, @Req() req: AppRequest) {
    if (id === user.id && (body.roleAssignments || body.status)) {
      throw new DomainError('SELF_ESCALATION', 'ไม่สามารถแก้ไขสิทธิ์หรือสถานะของตนเองได้', 403);
    }
    if (body.roleAssignments) await assertGrantable(this.prisma, user, body.roleAssignments);
    const { roleAssignments, startDate, endDate, levelId, levelEffectiveFrom, ...rest } = body;
    const fields = {
      ...rest,
      ...(startDate !== undefined ? { startDate: startDate ? toDate(startDate) : null } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? toDate(endDate) : null } : {}),
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.employee.findUnique({ where: { id }, include: { roleAssignments: { select: { roleId: true, orgUnitId: true } } } });
      if (!before) throw notFound('พนักงาน');
      const after = await tx.employee.update({ where: { id }, data: fields });
      if (levelId !== undefined && levelId !== before.levelId) {
        await setLevel(tx, id, levelId ?? null, levelEffectiveFrom ?? todayIn(loadConfig().TZ_BUSINESS), user.id);
      }
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
          after: { ...body, personalEmail: body.personalEmail ? '[set]' : body.personalEmail },
        },
        req,
        tx,
      );
      return after;
    }).catch((e) => {
      throw mapEmployeeUnique(e);
    });
    // Deactivation takes effect immediately (role changes already do: permissions are resolved per request).
    if (body.status === EmploymentStatus.INACTIVE) await this.sessions.revokeAllFor(id);
    return { id: updated.id, status: updated.status };
  }
}
