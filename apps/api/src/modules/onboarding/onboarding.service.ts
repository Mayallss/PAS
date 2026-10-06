import { HttpStatus, Injectable } from '@nestjs/common';
import { AssignmentKind, CaseKind, EmploymentStatus, EmploymentType, ExternalAccountStatus, Prisma, TaskStatus } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, toDate, toIsoDate, todayIn } from '../../common/dates';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AssetsService } from '../assets/assets.service';
import { AuditService } from '../audit/audit.service';
import { toPermissions } from '../authorization/permissions';
import { setLevel } from '../employees/level-history';
import type { AuthUser } from '../auth/auth.types';

type Tx = Prisma.TransactionClient;

export interface RoleGrant {
  roleId: string;
  orgUnitId: string | null;
}

export interface EmployeeProfileInput {
  employeeCode?: string | null;
  fullName?: string;
  fullNameEn?: string | null;
  nickname?: string | null;
  email?: string | null;
  personalEmail?: string | null;
  employmentType?: EmploymentType;
  startDate?: string | null;
  endDate?: string | null;
  institution?: string | null;
  departmentId?: string | null;
  orgUnitId?: string | null;
  levelId?: string | null;
}

export interface NewEmployeeInput extends EmployeeProfileInput {
  fullName: string;
  employmentType: EmploymentType;
  startDate: string;
  roleAssignments: RoleGrant[];
  device?: { assetCode: string; kind: 'PRIMARY' | 'LOAN'; dueDate?: string | null } | null;
}

export interface TaskUpdateInput {
  status: TaskStatus;
  note?: string | null;
  /** Account name in the task's system (required to complete a task tied to a system). */
  identifier?: string | null;
  /** Device to hand out (required to complete the "device" task). */
  assetCode?: string | null;
  assignKind?: 'PRIMARY' | 'LOAN';
  dueDate?: string | null;
}

/** The workbook kept real passwords next to account names; this system must never become that again. */
const SECRET_HINT = /\b(password|passwd|passcode|pass|pwd|pw)\s*[:=]\s*\S|รหัสผ่าน\s*[:=]?\s*\S/i;
export function assertNoSecret(...values: (string | null | undefined)[]) {
  if (values.some((v) => v && SECRET_HINT.test(v))) {
    throw new DomainError('SECRET_NOT_ALLOWED', 'ห้ามบันทึกรหัสผ่านในระบบ — เก็บไว้ใน Password manager หรือให้ผู้ใช้ตั้งเอง', HttpStatus.BAD_REQUEST);
  }
}

const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/** Privilege-escalation guard: you can only hand out permissions you hold yourself. */
export async function assertGrantable(prisma: PrismaService | Tx, user: AuthUser, grants: RoleGrant[]) {
  const roles = await prisma.role.findMany({ where: { id: { in: grants.map((a) => a.roleId) } } });
  if (roles.length !== new Set(grants.map((a) => a.roleId)).size) throw notFound('บทบาท');
  const excess = roles.flatMap((r) => toPermissions(r.permissions)).filter((p) => !user.permissions.includes(p));
  if (excess.length) {
    throw new DomainError('FORBIDDEN', 'ไม่สามารถมอบบทบาทที่มีสิทธิ์มากกว่าที่คุณมีได้', 403, { permissions: [...new Set(excess)] });
  }
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
  ) {}

  private today() {
    return todayIn(loadConfig().TZ_BUSINESS);
  }

  async options() {
    const [departments, systems, templates] = await Promise.all([
      this.prisma.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.externalSystem.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.onboardingTemplateItem.findMany({
        where: { isActive: true, kind: CaseKind.ONBOARDING },
        orderBy: { sortOrder: 'asc' },
        include: { system: { select: { name: true } } },
      }),
    ]);
    return { departments, systems, templates };
  }

  // -------------------------------------------------------------------------
  // New employee (wizard)
  // -------------------------------------------------------------------------

  async createEmployee(user: AuthUser, input: NewEmployeeInput, req: AppRequest) {
    if (input.endDate && input.endDate < input.startDate) throw new DomainError('VALIDATION_FAILED', 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มงาน', 400);
    await assertGrantable(this.prisma, user, input.roleAssignments);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: {
            employeeCode: clean(input.employeeCode),
            fullName: input.fullName.trim(),
            fullNameEn: clean(input.fullNameEn),
            nickname: clean(input.nickname),
            email: clean(input.email)?.toLowerCase() ?? null,
            personalEmail: clean(input.personalEmail)?.toLowerCase() ?? null,
            employmentType: input.employmentType,
            startDate: toDate(input.startDate),
            endDate: input.endDate ? toDate(input.endDate) : null,
            institution: clean(input.institution),
            departmentId: input.departmentId ?? null,
            orgUnitId: input.orgUnitId ?? null,
            levelId: input.levelId ?? null,
            status: EmploymentStatus.ACTIVE,
          },
        });
        if (input.levelId) await setLevel(tx, employee.id, input.levelId, input.startDate, user.id);
        const grants = [...new Map(input.roleAssignments.map((a) => [`${a.roleId}|${a.orgUnitId}`, a])).values()];
        await tx.roleAssignment.createMany({ data: grants.map((a) => ({ employeeId: employee.id, roleId: a.roleId, orgUnitId: a.orgUnitId })) });

        // Checklist from the template, filtered by employment type; due dates count from the start date.
        const templates = await tx.onboardingTemplateItem.findMany({ where: { isActive: true, kind: CaseKind.ONBOARDING }, orderBy: { sortOrder: 'asc' } });
        const applicable = templates.filter((t) => t.appliesTo.length === 0 || t.appliesTo.includes(input.employmentType));
        const kase = await tx.onboardingCase.create({
          data: { employeeId: employee.id, kind: CaseKind.ONBOARDING, openedOn: toDate(this.today()), openedById: user.id },
        });

        let assignmentId: string | null = null;
        if (input.device) {
          const a = await this.assets.assign(
            user,
            input.device.assetCode,
            { employeeId: employee.id, kind: input.device.kind as AssignmentKind, startDate: input.startDate, dueDate: input.device.dueDate ?? null, note: 'พนักงานใหม่' },
            req,
            tx,
          );
          assignmentId = a.id;
        }

        const now = new Date();
        for (const [i, t] of applicable.entries()) {
          const autoLogin = t.key === 'pas-login' && !!employee.email;
          const autoDevice = t.requiresAsset && !!assignmentId;
          const done = autoLogin || autoDevice;
          await tx.onboardingTask.create({
            data: {
              caseId: kase.id,
              templateItemId: t.id,
              title: t.title,
              dueDate: toDate(addDays(input.startDate, t.dueOffsetDays)),
              sortOrder: i,
              status: done ? TaskStatus.DONE : TaskStatus.TODO,
              doneAt: done ? now : null,
              doneById: done ? user.id : null,
              assignmentId: autoDevice ? assignmentId : null,
              note: autoLogin ? `เข้าระบบด้วย ${employee.email}` : null,
            },
          });
        }
        await this.closeIfComplete(kase.id, tx);
        await this.audit.record(
          { action: 'employee.create', resourceType: 'employee', resourceId: employee.id, after: { ...input, personalEmail: input.personalEmail ? '[set]' : null } },
          req,
          tx,
        );
        return { id: employee.id, caseId: kase.id };
      });
    } catch (e) {
      throw mapEmployeeUnique(e);
    }
  }

  // -------------------------------------------------------------------------
  // Employee profile (admin view)
  // -------------------------------------------------------------------------

  async profile(id: string, user: AuthUser) {
    const e = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        orgUnit: { select: { id: true, name: true } },
        level: { select: { id: true, code: true, name: true } },
        roleAssignments: { select: { roleId: true, orgUnitId: true, role: { select: { key: true, name: true } }, orgUnit: { select: { name: true } } } },
        externalAccounts: { orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], include: { system: { select: { id: true, key: true, name: true, identifierLabel: true } } } },
        cases: {
          orderBy: { createdAt: 'desc' },
          include: { tasks: { orderBy: { sortOrder: 'asc' }, include: taskInclude } },
        },
        levelHistory: { orderBy: { effectiveFrom: 'desc' }, include: { level: { select: { code: true, name: true } } } },
        assetAssignments: {
          orderBy: { startDate: 'desc' },
          include: { asset: { select: { code: true, brand: true, model: true, status: true, category: { select: { name: true } } } } },
        },
      },
    });
    if (!e) throw notFound('พนักงาน');
    const iso = (d: Date | null) => (d ? toIsoDate(d) : null);
    const seesPii = user.permissions.includes('employee.admin');
    return {
      id: e.id,
      employeeCode: e.employeeCode,
      fullName: e.fullName,
      fullNameEn: e.fullNameEn,
      nickname: e.nickname,
      email: e.email,
      personalEmail: seesPii ? e.personalEmail : undefined,
      employmentType: e.employmentType,
      status: e.status,
      startDate: iso(e.startDate),
      endDate: iso(e.endDate),
      institution: e.institution,
      department: e.department,
      orgUnit: e.orgUnit,
      level: e.level,
      roleAssignments: e.roleAssignments,
      levelHistory: e.levelHistory.map((h) => ({ code: h.level.code, name: h.level.name, effectiveFrom: iso(h.effectiveFrom), effectiveTo: iso(h.effectiveTo) })),
      accounts: e.externalAccounts.map((a) => ({ ...a, activatedOn: iso(a.activatedOn), disabledOn: iso(a.disabledOn) })),
      devices: e.assetAssignments.map((a) => ({
        assignmentId: a.id,
        code: a.asset.code,
        category: a.asset.category.name,
        model: [a.asset.brand, a.asset.model].filter(Boolean).join(' ') || null,
        kind: a.kind,
        startDate: iso(a.startDate),
        endDate: iso(a.endDate),
        dueDate: iso(a.dueDate),
      })),
      cases: e.cases.map((c) => ({ id: c.id, kind: c.kind, openedOn: iso(c.openedOn), closedOn: iso(c.closedOn), tasks: c.tasks.map(taskView) })),
    };
  }

  // -------------------------------------------------------------------------
  // Checklist
  // -------------------------------------------------------------------------

  /** Open tasks across everyone, soonest due first — the IT/Admin work queue. */
  async openTasks() {
    const tasks = await this.prisma.onboardingTask.findMany({
      where: { case: { closedOn: null } },
      orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }],
      include: { ...taskInclude, case: { select: { id: true, kind: true, employee: { select: { id: true, fullName: true, nickname: true, employeeCode: true, startDate: true, employmentType: true } } } } },
    });
    const today = this.today();
    return tasks.map((t) => ({
      ...taskView(t),
      overdue: t.status === TaskStatus.TODO && toIsoDate(t.dueDate) < today,
      case: { id: t.case.id, kind: t.case.kind },
      employee: { ...t.case.employee, startDate: t.case.employee.startDate ? toIsoDate(t.case.employee.startDate) : null },
    }));
  }

  async updateTask(user: AuthUser, taskId: string, input: TaskUpdateInput, req: AppRequest) {
    assertNoSecret(input.note, input.identifier);
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.onboardingTask.findUnique({ where: { id: taskId }, include: { case: true, templateItem: { include: { system: true } } } });
      if (!task) throw notFound('งาน');
      const employeeId = task.case.employeeId;
      const data: Prisma.OnboardingTaskUncheckedUpdateInput = { status: input.status, note: input.note === undefined ? task.note : clean(input.note) };

      if (input.status === TaskStatus.TODO) {
        data.doneAt = null;
        data.doneById = null;
      } else {
        data.doneAt = new Date();
        data.doneById = user.id;
      }

      if (input.status === TaskStatus.DONE) {
        const system = task.templateItem?.system;
        if (system && !task.externalAccountId) {
          const identifier = clean(input.identifier);
          if (!identifier) throw new DomainError('IDENTIFIER_REQUIRED', `ต้องระบุ${system.identifierLabel}ใน ${system.name}`, 400);
          const account = await this.createAccount(tx, { systemId: system.id, employeeId, identifier, status: ExternalAccountStatus.ACTIVE, activatedOn: this.today() });
          data.externalAccountId = account.id;
        }
        if (task.templateItem?.requiresAsset && !task.assignmentId) {
          const code = clean(input.assetCode);
          if (!code) throw new DomainError('ASSET_REQUIRED', 'ต้องเลือกเครื่องที่มอบให้ (ถ้านำเครื่องมาเอง ให้เลือก "ไม่เกี่ยวข้อง")', 400);
          const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
          const start = employee.startDate && toIsoDate(employee.startDate) > this.today() ? toIsoDate(employee.startDate) : this.today();
          const a = await this.assets.assign(user, code, { employeeId, kind: (input.assignKind ?? 'PRIMARY') as AssignmentKind, startDate: start, dueDate: input.dueDate ?? null, note: 'พนักงานใหม่' }, req, tx);
          data.assignmentId = a.id;
        }
      }

      await tx.onboardingTask.update({ where: { id: task.id }, data });
      await this.closeIfComplete(task.caseId, tx);
      await this.audit.record({ action: 'onboarding.task', resourceType: 'onboarding_task', resourceId: task.id, before: { status: task.status }, after: input }, req, tx);
      return { id: task.id, status: input.status };
    });
  }

  /** A case closes when nothing is left to do, and reopens if a task goes back to "to do". */
  private async closeIfComplete(caseId: string, tx: Tx) {
    const remaining = await tx.onboardingTask.count({ where: { caseId, status: TaskStatus.TODO } });
    await tx.onboardingCase.update({ where: { id: caseId }, data: { closedOn: remaining === 0 ? toDate(this.today()) : null } });
  }

  // -------------------------------------------------------------------------
  // Accounts in other systems
  // -------------------------------------------------------------------------

  private async createAccount(tx: Tx, input: { systemId: string; employeeId: string; identifier: string; status: ExternalAccountStatus; activatedOn?: string | null; note?: string | null }) {
    const system = await tx.externalSystem.findUnique({ where: { id: input.systemId } });
    if (!system) throw notFound('ระบบ');
    await this.assertIdentifierFree(tx, system, input.identifier);
    return tx.externalAccount.create({
      data: {
        systemId: system.id,
        employeeId: input.employeeId,
        identifier: input.identifier,
        status: input.status,
        activatedOn: input.status === ExternalAccountStatus.ACTIVE ? toDate(input.activatedOn ?? this.today()) : null,
        note: clean(input.note),
      },
    });
  }

  private async assertIdentifierFree(tx: Tx, system: { id: string; name: string; identifierUnique: boolean; identifierLabel: string }, identifier: string, exceptId?: string) {
    if (!system.identifierUnique) return;
    const clash = await tx.externalAccount.findFirst({
      where: { systemId: system.id, identifier: { equals: identifier, mode: 'insensitive' }, status: { not: ExternalAccountStatus.DISABLED }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      include: { employee: { select: { fullName: true } }, orgUnit: { select: { name: true } } },
    });
    if (clash) {
      const owner = clash.employee?.fullName ?? clash.orgUnit?.name ?? '';
      throw new DomainError('DUPLICATE', `${system.identifierLabel} "${identifier}" ใน ${system.name} ใช้อยู่แล้ว (${owner})`, HttpStatus.CONFLICT);
    }
  }

  async addAccount(employeeId: string, input: { systemId: string; identifier: string; status: ExternalAccountStatus; activatedOn?: string | null; note?: string | null }, req: AppRequest) {
    assertNoSecret(input.identifier, input.note);
    if (!(await this.prisma.employee.findUnique({ where: { id: employeeId } }))) throw notFound('พนักงาน');
    return this.prisma.$transaction(async (tx) => {
      const account = await this.createAccount(tx, { ...input, employeeId, identifier: input.identifier.trim() });
      await this.audit.record({ action: 'external_account.create', resourceType: 'external_account', resourceId: account.id, after: { employeeId, ...input } }, req, tx);
      return account;
    });
  }

  async updateAccount(id: string, input: { identifier?: string; status?: ExternalAccountStatus; note?: string | null; date?: string | null }, req: AppRequest) {
    assertNoSecret(input.identifier, input.note);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.externalAccount.findUnique({ where: { id }, include: { system: true } });
      if (!before) throw notFound('บัญชี');
      const identifier = input.identifier?.trim() ?? before.identifier;
      const status = input.status ?? before.status;
      if (status !== ExternalAccountStatus.DISABLED) await this.assertIdentifierFree(tx, before.system, identifier, id);
      const date = toDate(input.date ?? this.today());
      const data: Prisma.ExternalAccountUncheckedUpdateInput = { identifier, status };
      if ('note' in input) data.note = clean(input.note);
      if (status !== before.status) {
        if (status === ExternalAccountStatus.DISABLED) data.disabledOn = date;
        if (status === ExternalAccountStatus.ACTIVE) {
          data.disabledOn = null;
          data.activatedOn = before.activatedOn ?? date;
        }
      }
      const after = await tx.externalAccount.update({ where: { id }, data });
      await this.audit.record({ action: 'external_account.update', resourceType: 'external_account', resourceId: id, before: { identifier: before.identifier, status: before.status }, after: input }, req, tx);
      return after;
    });
  }
}

const taskInclude = {
  templateItem: { select: { key: true, description: true, requiresAsset: true, system: { select: { id: true, name: true, identifierLabel: true } } } },
  externalAccount: { select: { identifier: true, status: true } },
  assignment: { select: { asset: { select: { code: true } } } },
  doneBy: { select: { fullName: true } },
} as const;

type TaskRow = Prisma.OnboardingTaskGetPayload<{ include: typeof taskInclude }>;

function taskView(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    description: t.templateItem?.description ?? null,
    key: t.templateItem?.key ?? null,
    system: t.templateItem?.system ?? null,
    requiresAsset: t.templateItem?.requiresAsset ?? false,
    dueDate: toIsoDate(t.dueDate),
    status: t.status,
    note: t.note,
    account: t.externalAccount,
    assetCode: t.assignment?.asset.code ?? null,
    doneBy: t.doneBy?.fullName ?? null,
    doneAt: t.doneAt,
  };
}

export function mapEmployeeUnique(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const target = String((e.meta?.target as string[] | undefined)?.join(',') ?? '');
    if (target.includes('employee_code')) return new DomainError('DUPLICATE', 'มีรหัสพนักงานนี้แล้ว', HttpStatus.CONFLICT);
    if (target.includes('email')) return new DomainError('DUPLICATE', 'มีพนักงานที่ใช้อีเมลนี้แล้ว', HttpStatus.CONFLICT);
  }
  if (e instanceof Error && /employee_period_valid/.test(e.message)) return new DomainError('VALIDATION_FAILED', 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มงาน', HttpStatus.BAD_REQUEST);
  return e;
}
