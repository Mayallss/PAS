import { HttpStatus, Injectable } from '@nestjs/common';
import { EmploymentStatus, EmploymentType, LeaveRequestStatus, LeaveUnit, Prisma, TimeEntryStatus, WorkCategoryType } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, monthOf, monthRange, todayIn, toDate, toIsoDate } from '../../common/dates';
import { conflict, DomainError, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CalendarService } from '../calendar/calendar.service';
import { ScheduleService } from '../calendar/schedule.service';
import { CalendarSyncService } from '../calendar-sync/calendar-sync.service';
import { dateRange, entitlementFor, LEAVE_DAY_MINUTES, MAX_AHEAD_DAYS, MAX_RANGE_DAYS, minutesByYear, overlapProblem, planDays, type DayPlan } from './leave-rules';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

export interface LeaveInput {
  employeeId?: string | null;
  leaveTypeId: string;
  unit: LeaveUnit;
  startDate: string;
  endDate: string;
  /** HOURS only. */
  minutes?: number | null;
  reason: string;
  /** HR recording leave already agreed (e.g. sick leave after the fact): file and approve in one step. */
  approve?: boolean;
}

const ACTIVE = [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED];

const requestInclude = {
  employee: { select: { id: true, fullName: true, nickname: true, orgUnitId: true, orgUnit: { select: { name: true } } } },
  leaveType: { select: { id: true, key: true, name: true, color: true, certificateFromDays: true, paid: true } },
  days: { orderBy: { date: 'asc' as const }, select: { date: true, minutes: true } },
  decidedBy: { select: { fullName: true } },
  cancelledBy: { select: { fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.LeaveRequestInclude;

type RequestRow = Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>;

function requestDto(r: RequestRow) {
  const cert = r.leaveType.certificateFromDays;
  return {
    id: r.id,
    employee: { id: r.employee.id, fullName: r.employee.fullName, nickname: r.employee.nickname, team: r.employee.orgUnit?.name ?? null },
    type: { id: r.leaveType.id, key: r.leaveType.key, name: r.leaveType.name, color: r.leaveType.color, paid: r.leaveType.paid },
    unit: r.unit,
    startDate: toIsoDate(r.startDate),
    endDate: toIsoDate(r.endDate),
    minutes: r.minutes,
    days: r.days.map((d) => ({ date: toIsoDate(d.date), minutes: d.minutes })),
    reason: r.reason,
    status: r.status,
    overQuota: r.overQuota,
    needsCertificate: cert != null && r.unit === LeaveUnit.DAYS && r.days.length >= cert,
    documentReceived: r.documentReceived,
    decidedBy: r.decidedBy?.fullName ?? null,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    cancelledBy: r.cancelledBy?.fullName ?? null,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    filedBy: r.createdBy.id !== r.employee.id ? r.createdBy.fullName : null,
    createdAt: r.createdAt,
    version: r.version,
  };
}

export type LeaveRequestDto = ReturnType<typeof requestDto>;

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly calendar: CalendarService,
    private readonly schedules: ScheduleService,
    private readonly sync: CalendarSyncService,
  ) {}

  private today() {
    return todayIn(loadConfig().TZ_BUSINESS);
  }

  private isHr(user: AuthUser) {
    return user.permissions.includes('leave.manage');
  }

  // -------------------------------------------------------------------------
  // Who approves: the manager of the person's team, else of the parent team … up the tree; HR always may.
  // -------------------------------------------------------------------------

  private async units(db: Db = this.prisma) {
    return db.orgUnit.findMany({ select: { id: true, parentId: true, managerId: true, manager: { select: { fullName: true } } } });
  }

  /** Managers above the employee, nearest first (never the employee themself). */
  private async managerChain(employee: { id: string; orgUnitId: string | null }, db: Db = this.prisma) {
    const units = await this.units(db);
    const byId = new Map(units.map((u) => [u.id, u]));
    const chain: { id: string; name: string }[] = [];
    for (let id = employee.orgUnitId, guard = 0; id && guard < 50; id = byId.get(id)?.parentId ?? null, guard++) {
      const u = byId.get(id);
      if (u?.managerId && u.managerId !== employee.id && !chain.some((c) => c.id === u.managerId)) chain.push({ id: u.managerId, name: u.manager!.fullName });
    }
    return chain;
  }

  /** Teams the user manages, with every sub-team. */
  private async managedUnitIds(userId: string, db: Db = this.prisma) {
    const units = await this.units(db);
    const scope = new Set(units.filter((u) => u.managerId === userId).map((u) => u.id));
    for (let grew = true; grew; ) {
      grew = false;
      for (const u of units) {
        if (u.parentId && scope.has(u.parentId) && !scope.has(u.id)) {
          scope.add(u.id);
          grew = true;
        }
      }
    }
    return scope;
  }

  private async canDecide(user: AuthUser, employee: { id: string; orgUnitId: string | null }, db: Db = this.prisma) {
    if (employee.id === user.id) return false; // nobody approves their own leave, HR included
    if (this.isHr(user)) return true;
    return (await this.managerChain(employee, db)).some((m) => m.id === user.id);
  }

  /** Requester, their managers, HR — the people who may read a request including its reason. */
  private async assertCanRead(user: AuthUser, employee: { id: string; orgUnitId: string | null }) {
    if (employee.id === user.id || this.isHr(user)) return;
    if ((await this.managerChain(employee)).some((m) => m.id === user.id)) return;
    throw forbidden('ไม่มีสิทธิ์ดูใบลานี้');
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async types(all = false) {
    const rows = await this.prisma.leaveType.findMany({
      where: all ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { workCategory: { select: { name: true, legacyId: true } } },
    });
    return rows.map((t) => ({ ...t, annualDays: t.annualMinutes == null ? null : t.annualMinutes / LEAVE_DAY_MINUTES }));
  }

  private async requiredMap(employee: { id: string; orgUnitId: string | null }, from: string, to: string, db: Db = this.prisma) {
    const holidays = await this.calendar.holidayMinutes(from, to, db);
    const required = await this.schedules.required([employee], dateRange(from, to), holidays, db);
    return required.get(employee.id) ?? new Map<string, number>();
  }

  /** Entitlement / used / pending / remaining per type for one year (minutes). */
  async balances(employeeId: string, year: number, db: Db = this.prisma) {
    const yearRange = { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) };
    const [employee, types, overrides, days, legacy] = await Promise.all([
      db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { startDate: true, employmentType: true } }),
      db.leaveType.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      db.leaveEntitlement.findMany({ where: { employeeId, year } }),
      db.leaveDay.findMany({
        where: { date: yearRange, request: { employeeId, status: { in: ACTIVE } } },
        select: { minutes: true, request: { select: { leaveTypeId: true, status: true } } },
      }),
      // Leave recorded straight in the timesheet before this module (legacy data, go-live year) still counts as used.
      db.timeEntry.findMany({
        where: { employeeId, deletedAt: null, leaveRequestId: null, workDate: yearRange, engagement: { workCategory: { type: WorkCategoryType.LEAVE } } },
        select: { durationMinutes: true, engagement: { select: { workCategoryId: true } } },
      }),
    ]);
    const emp = { startDate: employee.startDate ? toIsoDate(employee.startDate) : null, employmentType: employee.employmentType };
    return types.map((t) => {
      const override = overrides.find((o) => o.leaveTypeId === t.id);
      const entitled = entitlementFor(t, year, emp, override?.minutes ?? null);
      const mine = days.filter((d) => d.request.leaveTypeId === t.id);
      const recorded = legacy.filter((e) => e.engagement.workCategoryId === t.workCategoryId).reduce((a, e) => a + e.durationMinutes, 0);
      const used = mine.filter((d) => d.request.status === LeaveRequestStatus.APPROVED).reduce((a, d) => a + d.minutes, 0) + recorded;
      const pending = mine.filter((d) => d.request.status === LeaveRequestStatus.PENDING).reduce((a, d) => a + d.minutes, 0);
      return {
        type: { id: t.id, key: t.key, name: t.name, color: t.color, paid: t.paid, allowHours: t.allowHours, certificateFromDays: t.certificateFromDays },
        year,
        entitledMinutes: entitled,
        overridden: Boolean(override),
        note: override?.note ?? null,
        usedMinutes: used,
        pendingMinutes: pending,
        remainingMinutes: entitled == null ? null : entitled - used - pending,
      };
    });
  }

  async mine(user: AuthUser, year: number) {
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, orgUnitId: true } });
    const [balances, requests, chain] = await Promise.all([
      this.balances(user.id, year),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: user.id, startDate: { lte: toDate(`${year}-12-31`) }, endDate: { gte: toDate(`${year}-01-01`) } },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        include: requestInclude,
      }),
      this.managerChain(employee),
    ]);
    const today = this.today();
    return {
      year,
      today,
      dayMinutes: LEAVE_DAY_MINUTES,
      approver: chain[0]?.name ?? null,
      balances,
      requests: requests.map((r) => ({
        ...requestDto(r),
        canCancel: r.status === LeaveRequestStatus.PENDING || (r.status === LeaveRequestStatus.APPROVED && toIsoDate(r.startDate) > today),
      })),
    };
  }

  async get(user: AuthUser, id: string) {
    const r = await this.prisma.leaveRequest.findUnique({ where: { id }, include: requestInclude });
    if (!r) throw notFound('ใบลา');
    await this.assertCanRead(user, r.employee);
    return { ...requestDto(r), canDecide: r.status === LeaveRequestStatus.PENDING && (await this.canDecide(user, r.employee)) };
  }

  /** Waiting for the user's decision: their teams (and sub-teams); HR sees all, flagged when no team lead is above. */
  async approvals(user: AuthUser) {
    const managed = await this.managedUnitIds(user.id);
    if (!managed.size && !this.isHr(user)) return [];
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        status: LeaveRequestStatus.PENDING,
        employeeId: { not: user.id },
        ...(this.isHr(user) ? {} : { employee: { orgUnitId: { in: [...managed] } } }),
      },
      orderBy: [{ startDate: 'asc' }],
      include: requestInclude,
    });
    const units = await this.units();
    const byId = new Map(units.map((u) => [u.id, u]));
    const hasLead = (e: { id: string; orgUnitId: string | null }) => {
      for (let id = e.orgUnitId, g = 0; id && g < 50; id = byId.get(id)?.parentId ?? null, g++) {
        const u = byId.get(id);
        if (u?.managerId && u.managerId !== e.id) return true;
      }
      return false;
    };
    const out = [];
    for (const r of rows) {
      const balance = (await this.balances(r.employeeId, Number(toIsoDate(r.startDate).slice(0, 4)))).find((b) => b.type.id === r.leaveTypeId) ?? null;
      const inMyTeams = r.employee.orgUnitId != null && managed.has(r.employee.orgUnitId);
      out.push({ ...requestDto(r), noTeamApprover: !hasLead(r.employee), inMyTeams, balance });
    }
    return out;
  }

  /** Bell: how many requests wait for this user (team leads: their teams; HR: those with no team lead above). */
  async attentionCount(user: AuthUser): Promise<number> {
    // HR is not pinged for requests a team lead will handle.
    return (await this.approvals(user)).filter((r) => r.inMyTeams || r.noTeamApprover).length;
  }

  /**
   * Who is away this month. Colleagues see that someone is on leave, not why or which type (sick leave is
   * health data); the person, their managers and HR see the type.
   */
  async teamCalendar(user: AuthUser, month: string) {
    const { from, to } = monthRange(month);
    const me = await this.prisma.employee.findUniqueOrThrow({ where: { id: user.id }, select: { orgUnitId: true } });
    const managed = await this.managedUnitIds(user.id);
    const hr = this.isHr(user);
    const unitFilter = hr ? undefined : [...new Set([...managed, ...(me.orgUnitId ? [me.orgUnitId] : [])])];
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        status: { in: ACTIVE },
        startDate: { lte: toDate(to) },
        endDate: { gte: toDate(from) },
        ...(unitFilter ? { OR: [{ employeeId: user.id }, { employee: { orgUnitId: { in: unitFilter } } }] } : {}),
      },
      orderBy: { startDate: 'asc' },
      include: { employee: { select: { id: true, fullName: true, nickname: true, orgUnitId: true } }, leaveType: { select: { name: true, color: true } }, days: { select: { date: true, minutes: true } } },
    });
    return {
      month,
      entries: rows.map((r) => {
        const seesType = hr || r.employeeId === user.id || (r.employee.orgUnitId != null && managed.has(r.employee.orgUnitId));
        return {
          id: r.id,
          employee: { id: r.employee.id, name: r.employee.nickname ? `${r.employee.nickname} (${r.employee.fullName})` : r.employee.fullName },
          status: r.status,
          type: seesType ? { name: r.leaveType.name, color: r.leaveType.color } : null,
          unit: r.unit,
          days: r.days.map((d) => ({ date: toIsoDate(d.date), minutes: d.minutes })).filter((d) => d.date >= from && d.date <= to),
        };
      }),
    };
  }

  /** HR: every request, filtered. */
  async list(filter: { status?: LeaveRequestStatus; year?: number; employeeId?: string }) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
        ...(filter.year ? { startDate: { lte: toDate(`${filter.year}-12-31`) }, endDate: { gte: toDate(`${filter.year}-01-01`) } } : {}),
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: requestInclude,
    });
    return rows.map(requestDto);
  }

  // -------------------------------------------------------------------------
  // Filing
  // -------------------------------------------------------------------------

  /** Live calculation for the form: charged days and the balance after this request. */
  async preview(user: AuthUser, input: Omit<LeaveInput, 'reason' | 'approve'>) {
    const { employee, type } = await this.loadTarget(user, input);
    const required = await this.requiredMap(employee, input.startDate, input.endDate);
    const policy = await this.calendar.policy();
    const plan = planDays(input, required, policy.incrementMinutes);
    if ('error' in plan) return { ok: false as const, ...plan.error };
    const byYear = minutesByYear(plan.days);
    const balances = await Promise.all([...byYear.keys()].map(async (y) => (await this.balances(employee.id, y)).find((b) => b.type.id === type.id)!));
    const overQuota = balances.some((b) => b.remainingMinutes != null && b.remainingMinutes < (byYear.get(b.year) ?? 0));
    return {
      ok: true as const,
      days: plan.days,
      minutes: plan.days.reduce((a, d) => a + d.minutes, 0),
      overQuota,
      needsCertificate: type.certificateFromDays != null && input.unit === LeaveUnit.DAYS && plan.days.length >= type.certificateFromDays,
      balances: balances.map((b) => ({ year: b.year, remainingMinutes: b.remainingMinutes, afterMinutes: b.remainingMinutes == null ? null : b.remainingMinutes - (byYear.get(b.year) ?? 0) })),
    };
  }

  private async loadTarget(user: AuthUser, input: { employeeId?: string | null; leaveTypeId: string; unit: LeaveUnit; startDate: string; endDate: string }) {
    const employeeId = input.employeeId ?? user.id;
    if (employeeId !== user.id && !this.isHr(user)) throw forbidden('ยื่นใบลาแทนผู้อื่นได้เฉพาะ HR');
    const [employee, type] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, orgUnitId: true, status: true, employmentType: true, fullName: true } }),
      this.prisma.leaveType.findUnique({ where: { id: input.leaveTypeId } }),
    ]);
    if (!employee) throw notFound('พนักงาน');
    if (!type || !type.isActive) throw notFound('ประเภทการลา');
    if (employee.status !== EmploymentStatus.ACTIVE) throw new DomainError('EMPLOYEE_INACTIVE', 'พนักงานคนนี้ไม่ได้ทำงานอยู่แล้ว', 422);
    if (type.appliesTo.length && !type.appliesTo.includes(employee.employmentType as EmploymentType)) {
      throw new DomainError('TYPE_NOT_APPLICABLE', `${type.name} ไม่ใช้กับพนักงานประเภทนี้`, 422);
    }
    if (input.unit === LeaveUnit.HOURS && !type.allowHours) throw new DomainError('HOURS_NOT_ALLOWED', `${type.name} ลาเป็นชั่วโมงไม่ได้`, 422);
    if (dateRange(input.startDate, input.endDate).length > MAX_RANGE_DAYS) {
      throw new DomainError('RANGE_TOO_LONG', `ยื่นได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน — แบ่งเป็นหลายใบ`, 422);
    }
    const today = this.today();
    if (input.endDate > addDays(today, MAX_AHEAD_DAYS)) throw new DomainError('FUTURE_LIMIT', `ยื่นล่วงหน้าได้ไม่เกิน ${MAX_AHEAD_DAYS} วัน`, 422);
    return { employee, type };
  }

  private async assertMonthsOpen(dates: string[], db: Db) {
    for (const m of new Set(dates.map(monthOf))) {
      if (await this.calendar.isLocked(m, db)) throw new DomainError('PERIOD_LOCKED', `งวด ${m} ปิดแล้ว — ติดต่อผู้ดูแลเพื่อเปิดงวดก่อน`, 422);
    }
  }

  /** Serialises everything touching one person's leave (overlap and balance checks race otherwise). */
  private async lockEmployee(tx: Tx, employeeId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'leave:' + employeeId}))`;
  }

  private async activeDays(tx: Db, employeeId: string, from: string, to: string, exceptRequestId?: string) {
    const rows = await tx.leaveDay.findMany({
      where: {
        date: { gte: toDate(from), lte: toDate(to) },
        request: { employeeId, status: { in: ACTIVE }, ...(exceptRequestId ? { id: { not: exceptRequestId } } : {}) },
      },
      select: { date: true, minutes: true, request: { select: { leaveTypeId: true } } },
    });
    return rows.map((r) => ({ date: toIsoDate(r.date), minutes: r.minutes, typeId: r.request.leaveTypeId }));
  }

  async create(user: AuthUser, input: LeaveInput, req: AppRequest) {
    const { employee, type } = await this.loadTarget(user, input);
    const hr = this.isHr(user);
    if (input.approve && !hr) throw forbidden('อนุมัติทันทีได้เฉพาะ HR');
    if (input.approve && employee.id === user.id) throw forbidden('อนุมัติใบลาของตนเองไม่ได้');
    const policy = await this.calendar.policy();
    // Same backdating rule as the timesheet for employees; HR may record older leave (paper forms, sick leave after the fact).
    if (!hr && policy.backdateDays != null && input.startDate < addDays(this.today(), -policy.backdateDays)) {
      throw new DomainError('BACKDATE_LIMIT', `ยื่นย้อนหลังได้ไม่เกิน ${policy.backdateDays} วัน — ติดต่อ HR`, 422);
    }

    const id = await this.prisma.$transaction(async (tx) => {
      await this.lockEmployee(tx, employee.id);
      const required = await this.requiredMap(employee, input.startDate, input.endDate, tx);
      const plan = planDays(input, required, policy.incrementMinutes);
      if ('error' in plan) throw new DomainError(plan.error.code, plan.error.message, 422);
      await this.assertMonthsOpen(plan.days.map((d) => d.date), tx);
      const overlap = overlapProblem(plan.days, type.id, await this.activeDays(tx, employee.id, input.startDate, input.endDate), required);
      if (overlap) throw new DomainError(overlap.code, overlap.message, HttpStatus.CONFLICT, { date: overlap.date });

      const byYear = minutesByYear(plan.days);
      let overQuota = false;
      for (const [y, minutes] of byYear) {
        const b = (await this.balances(employee.id, y, tx)).find((x) => x.type.id === type.id);
        if (b?.remainingMinutes != null && b.remainingMinutes < minutes) overQuota = true;
      }
      const created = await tx.leaveRequest.create({
        data: {
          employeeId: employee.id,
          leaveTypeId: type.id,
          unit: input.unit,
          startDate: toDate(input.startDate),
          endDate: toDate(input.endDate),
          minutes: plan.days.reduce((a, d) => a + d.minutes, 0),
          reason: input.reason.trim(),
          overQuota,
          createdById: user.id,
          days: { create: plan.days.map((d) => ({ date: toDate(d.date), minutes: d.minutes })) },
        },
      });
      await this.audit.record(
        { action: 'leave.request', resourceType: 'leave_request', resourceId: created.id, after: { employeeId: employee.id, type: type.key, unit: input.unit, startDate: input.startDate, endDate: input.endDate, minutes: created.minutes, overQuota } },
        req,
        tx,
      );
      if (input.approve) await this.approveTx(tx, user, created.id, 'บันทึกโดย HR', req);
      return created.id;
    });
    return this.getDto(id);
  }

  private async getDto(id: string) {
    return requestDto(await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }));
  }

  // -------------------------------------------------------------------------
  // Decide / cancel
  // -------------------------------------------------------------------------

  async decide(user: AuthUser, id: string, input: { decision: 'APPROVE' | 'REJECT'; note?: string | null; expectedVersion: number }, req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.leaveRequest.findUnique({ where: { id }, include: { employee: { select: { id: true, orgUnitId: true } } } });
      if (!r) throw notFound('ใบลา');
      await this.lockEmployee(tx, r.employeeId);
      if (!(await this.canDecide(user, r.employee, tx))) throw forbidden(r.employeeId === user.id ? 'อนุมัติใบลาของตนเองไม่ได้' : 'ไม่มีสิทธิ์อนุมัติใบลานี้');
      if (r.version !== input.expectedVersion) throw conflict();
      if (r.status !== LeaveRequestStatus.PENDING) throw new DomainError('NOT_PENDING', 'ใบลานี้ไม่ได้รออนุมัติแล้ว', HttpStatus.CONFLICT);
      if (input.decision === 'APPROVE') {
        await this.approveTx(tx, user, id, input.note ?? null, req);
        return;
      }
      const note = input.note?.trim();
      if (!note) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ', 400);
      await tx.leaveRequest.update({
        where: { id },
        data: { status: LeaveRequestStatus.REJECTED, decidedById: user.id, decidedAt: new Date(), decisionNote: note, version: { increment: 1 } },
      });
      await this.audit.record({ action: 'leave.reject', resourceType: 'leave_request', resourceId: id, after: { note } }, req, tx);
    });
    return this.getDto(id);
  }

  /** The leave activity's internal engagement (PAS × ลาป่วย …) — what the timesheet rows are posted to. */
  private async leaveEngagement(tx: Tx, workCategoryId: string) {
    const e = await tx.engagement.findFirst({ where: { workCategoryId, periodStart: null }, orderBy: [{ isActive: 'desc' }, { id: 'asc' }] });
    if (!e) throw new DomainError('LEAVE_NOT_CONFIGURED', 'ประเภทการลานี้ยังไม่ผูกกับงานในบันทึกเวลา — ติดต่อผู้ดูแลระบบ', 422);
    return e;
  }

  /**
   * Approve: recompute the days against today's schedule and holidays (they may have changed since filing),
   * re-check overlap and locked months, then post one read-only timesheet row per day.
   * A leave row the person had typed into the timesheet themselves is taken over rather than duplicated.
   */
  private async approveTx(tx: Tx, user: AuthUser, id: string, note: string | null, req: AppRequest) {
    const r = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: { leaveType: true, employee: { select: { id: true, orgUnitId: true } } } });
    const start = toIsoDate(r.startDate);
    const end = toIsoDate(r.endDate);
    const required = await this.requiredMap(r.employee, start, end, tx);
    const policy = await this.calendar.policy(tx);
    const plan = planDays({ unit: r.unit, startDate: start, endDate: end, minutes: r.unit === LeaveUnit.HOURS ? r.minutes : null }, required, policy.incrementMinutes);
    if ('error' in plan) throw new DomainError(plan.error.code, plan.error.message, 422);
    const days: DayPlan[] = plan.days;
    await this.assertMonthsOpen(days.map((d) => d.date), tx);
    const overlap = overlapProblem(days, r.leaveTypeId, await this.activeDays(tx, r.employeeId, start, end, id), required);
    if (overlap) throw new DomainError(overlap.code, overlap.message, HttpStatus.CONFLICT, { date: overlap.date });

    // Keep the stored days in line with what is actually charged.
    await tx.leaveDay.deleteMany({ where: { requestId: id } });
    await tx.leaveDay.createMany({ data: days.map((d) => ({ requestId: id, date: toDate(d.date), minutes: d.minutes })) });

    const engagement = await this.leaveEngagement(tx, r.leaveType.workCategoryId);
    const description = `ลา: ${r.reason}`.slice(0, 500);
    for (const d of days) {
      const workDate = toDate(d.date);
      const existing = await tx.timeEntry.findFirst({ where: { employeeId: r.employeeId, engagementId: engagement.id, workDate, deletedAt: null } });
      if (policy.maxDailyMinutes != null) {
        const others = await tx.timeEntry.aggregate({
          _sum: { durationMinutes: true },
          where: { employeeId: r.employeeId, workDate, deletedAt: null, ...(existing ? { id: { not: existing.id } } : {}) },
        });
        if ((others._sum.durationMinutes ?? 0) + d.minutes > policy.maxDailyMinutes) {
          throw new DomainError('DAILY_LIMIT', `วันที่ ${d.date} มีเวลาทำงานบันทึกไว้แล้ว รวมกับการลาเกิน ${policy.maxDailyMinutes / 60} ชม. — ให้พนักงานแก้บันทึกเวลาก่อน`, 422);
        }
      }
      if (existing) {
        if (existing.leaveRequestId && existing.leaveRequestId !== id) throw new DomainError('LEAVE_SAME_DAY', `วันที่ ${d.date} มีใบลาประเภทนี้อนุมัติแล้ว`, HttpStatus.CONFLICT);
        await tx.timeEntry.update({
          where: { id: existing.id },
          data: { durationMinutes: d.minutes, description, leaveRequestId: id, status: TimeEntryStatus.APPROVED, updatedById: user.id, version: { increment: 1 } },
        });
      } else {
        await tx.timeEntry.create({
          data: {
            employeeId: r.employeeId,
            engagementId: engagement.id,
            workDate,
            durationMinutes: d.minutes,
            description,
            status: TimeEntryStatus.APPROVED,
            leaveRequestId: id,
            createdById: user.id,
            updatedById: user.id,
          },
        });
      }
    }
    await tx.leaveRequest.update({
      where: { id },
      data: {
        status: LeaveRequestStatus.APPROVED,
        minutes: days.reduce((a, d) => a + d.minutes, 0),
        decidedById: user.id,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
        version: { increment: 1 },
      },
    });
    await this.sync.markPending(tx, 'leave_request', id);
    await this.audit.record({ action: 'leave.approve', resourceType: 'leave_request', resourceId: id, after: { days, note } }, req, tx);
  }

  /**
   * The requester cancels a pending request any time, an approved one only before it starts; HR cancels any
   * (open months only). Cancelling approved leave removes its timesheet rows.
   */
  async cancel(user: AuthUser, id: string, input: { reason?: string | null; expectedVersion: number }, req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.leaveRequest.findUnique({ where: { id } });
      if (!r) throw notFound('ใบลา');
      await this.lockEmployee(tx, r.employeeId);
      if (r.version !== input.expectedVersion) throw conflict();
      const own = r.employeeId === user.id;
      const hr = this.isHr(user);
      if (r.status !== LeaveRequestStatus.PENDING && r.status !== LeaveRequestStatus.APPROVED) {
        throw new DomainError('NOT_CANCELLABLE', 'ใบลานี้ยกเลิกไม่ได้แล้ว', HttpStatus.CONFLICT);
      }
      if (!own && !hr) throw forbidden('ยกเลิกได้เฉพาะผู้ลาหรือ HR');
      if (r.status === LeaveRequestStatus.APPROVED) {
        if (!hr && toIsoDate(r.startDate) <= this.today()) {
          throw new DomainError('ALREADY_STARTED', 'ใบลาที่อนุมัติแล้วและเริ่มแล้ว ยกเลิกได้โดย HR เท่านั้น', 422);
        }
        const days = await tx.leaveDay.findMany({ where: { requestId: id }, select: { date: true } });
        await this.assertMonthsOpen(days.map((d) => toIsoDate(d.date)), tx);
        await tx.timeEntry.updateMany({
          where: { leaveRequestId: id, deletedAt: null },
          data: { deletedAt: new Date(), deletedById: user.id, updatedById: user.id, version: { increment: 1 } },
        });
        await this.sync.markPending(tx, 'leave_request', id);
      }
      const reason = input.reason?.trim() || null;
      await tx.leaveRequest.update({
        where: { id },
        data: { status: LeaveRequestStatus.CANCELLED, cancelledById: user.id, cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } },
      });
      await this.audit.record({ action: 'leave.cancel', resourceType: 'leave_request', resourceId: id, before: { status: r.status }, after: { reason } }, req, tx);
    });
    return this.getDto(id);
  }

  async setDocumentReceived(id: string, received: boolean, req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.leaveRequest.findUnique({ where: { id } });
      if (!r) throw notFound('ใบลา');
      await tx.leaveRequest.update({ where: { id }, data: { documentReceived: received } });
      await this.audit.record({ action: 'leave.document', resourceType: 'leave_request', resourceId: id, after: { received } }, req, tx);
    });
    return this.getDto(id);
  }

  // -------------------------------------------------------------------------
  // HR: entitlements and types
  // -------------------------------------------------------------------------

  async entitlements(year: number) {
    const employees = await this.prisma.employee.findMany({
      where: { status: EmploymentStatus.ACTIVE },
      orderBy: [{ employeeCode: 'asc' }, { fullName: 'asc' }],
      select: { id: true, fullName: true, nickname: true, employeeCode: true, employmentType: true, startDate: true, orgUnit: { select: { name: true } } },
    });
    const rows = [];
    for (const e of employees) {
      rows.push({
        employee: { id: e.id, fullName: e.fullName, nickname: e.nickname, code: e.employeeCode, team: e.orgUnit?.name ?? null, employmentType: e.employmentType, startDate: e.startDate ? toIsoDate(e.startDate) : null },
        balances: await this.balances(e.id, year),
      });
    }
    return { year, dayMinutes: LEAVE_DAY_MINUTES, rows };
  }

  /** null minutes = back to the default. */
  async setEntitlement(user: AuthUser, input: { employeeId: string; leaveTypeId: string; year: number; minutes: number | null; note?: string | null }, req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const where = { employeeId_leaveTypeId_year: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year } };
      const before = await tx.leaveEntitlement.findUnique({ where });
      if (input.minutes == null) {
        if (before) await tx.leaveEntitlement.delete({ where });
      } else {
        await tx.leaveEntitlement.upsert({
          where,
          create: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year, minutes: input.minutes, note: input.note?.trim() || null, setById: user.id },
          update: { minutes: input.minutes, note: input.note?.trim() || null, setById: user.id },
        });
      }
      await this.audit.record(
        { action: 'leave.entitlement', resourceType: 'employee', resourceId: input.employeeId, before: before ? { minutes: before.minutes } : null, after: { leaveTypeId: input.leaveTypeId, year: input.year, minutes: input.minutes, note: input.note } },
        req,
        tx,
      );
    });
    return (await this.balances(input.employeeId, input.year)).find((b) => b.type.id === input.leaveTypeId);
  }

  async updateType(
    id: string,
    input: Partial<{ name: string; annualMinutes: number | null; minTenureMonths: number; paid: boolean; allowHours: boolean; certificateFromDays: number | null; appliesTo: EmploymentType[]; color: string | null; sortOrder: number; isActive: boolean; source: string | null }>,
    req: AppRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.leaveType.findUnique({ where: { id } });
      if (!before) throw notFound('ประเภทการลา');
      const after = await tx.leaveType.update({ where: { id }, data: input });
      if (input.name && input.name !== before.name) await tx.workCategory.update({ where: { id: before.workCategoryId }, data: { name: input.name } });
      await this.audit.record({ action: 'leave.type.update', resourceType: 'leave_type', resourceId: id, before, after: input }, req, tx);
      return after;
    });
  }

  /**
   * A new leave type (e.g. ลาคลอด, ลาบวช) gets its own LEAVE activity next to the existing ones and an engagement
   * on the same internal customer, so approved leave shows in the timesheet and leave reports like the legacy types.
   */
  async createType(input: { key: string; name: string; annualMinutes: number | null; minTenureMonths: number; paid: boolean; allowHours: boolean; certificateFromDays: number | null; appliesTo: EmploymentType[]; color: string | null; source: string | null }, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.leaveType.findUnique({ where: { key: input.key } })) throw new DomainError('DUPLICATE', 'มีรหัสประเภทนี้แล้ว', HttpStatus.CONFLICT);
      const sibling = await tx.leaveType.findFirst({ orderBy: { sortOrder: 'asc' }, include: { workCategory: true } });
      const siblingEngagement = sibling ? await tx.engagement.findFirst({ where: { workCategoryId: sibling.workCategoryId, periodStart: null } }) : null;
      if (!sibling || !siblingEngagement) throw new DomainError('LEAVE_NOT_CONFIGURED', 'ยังไม่มีประเภทการลาเดิมให้ใช้เป็นต้นแบบ', 422);
      const wc = await tx.workCategory.create({
        data: { name: input.name, type: WorkCategoryType.LEAVE, parentId: sibling.workCategory.parentId, isBillable: false, sortOrder: sibling.workCategory.sortOrder + 1 },
      });
      await tx.engagement.create({ data: { customerId: siblingEngagement.customerId, workCategoryId: wc.id } });
      const maxSort = await tx.leaveType.aggregate({ _max: { sortOrder: true } });
      const created = await tx.leaveType.create({ data: { ...input, workCategoryId: wc.id, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 } });
      await this.audit.record({ action: 'leave.type.create', resourceType: 'leave_type', resourceId: created.id, after: input }, req, tx);
      return created;
    });
  }
}
