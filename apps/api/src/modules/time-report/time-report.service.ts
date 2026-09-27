import { HttpStatus, Injectable } from '@nestjs/common';
import { EmploymentStatus, Prisma, TimeEntry } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, isWeekend, isoWeekday, monthOf, monthRange, todayIn, toDate, toIsoDate, weekRange } from '../../common/dates';
import { conflict, DomainError, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AccessService } from '../authorization/access.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CalendarService } from '../calendar/calendar.service';
import { checkDelete, checkEntry, dayStatusFor, requiredFrom, Violation } from './policy';
import { ScheduleService, ScheduledEmployee } from '../calendar/schedule.service';

export interface UpsertEntryInput {
  engagementId: string;
  workDate: string;
  durationMinutes: number;
  description?: string | null;
  /** Version the client last saw; required when the cell already has an entry. */
  expectedVersion?: number;
}

const entryDto = (e: TimeEntry) => ({
  id: e.id,
  engagementId: e.engagementId,
  workDate: toIsoDate(e.workDate),
  durationMinutes: e.durationMinutes,
  description: e.description,
  status: e.status,
  version: e.version,
  updatedAt: e.updatedAt,
});

const auditSnapshot = (e: TimeEntry) => ({
  employeeId: e.employeeId,
  engagementId: e.engagementId,
  workDate: toIsoDate(e.workDate),
  durationMinutes: e.durationMinutes,
  description: e.description,
  version: e.version,
});

export const ENGAGEMENT_INCLUDE = { customer: true, workCategory: { include: { parent: { select: { name: true } } } } } as const;

type EngagementWithRefs = Prisma.EngagementGetPayload<{ include: typeof ENGAGEMENT_INCLUDE }>;

/** A loggable task = customer × work category, flattened for the UI. */
export const engagementDto = (e: EngagementWithRefs) => ({
  engagementId: e.id,
  active: e.isActive && e.customer.isActive && e.workCategory.isActive,
  customer: { id: e.customer.id, code: e.customer.code, name: e.customer.name },
  workCategory: { id: e.workCategory.id, name: e.workCategory.name, type: e.workCategory.type, group: e.workCategory.parent?.name ?? null },
  period: e.periodStart ? { start: toIsoDate(e.periodStart), end: e.periodEnd ? toIsoDate(e.periodEnd) : null } : null,
});

type EngagementView = ReturnType<typeof engagementDto>;
type WeekRow = EngagementView & { cells: Record<string, ReturnType<typeof entryDto>>; totalMinutes: number; carried: boolean };

function rejectIf(violations: Violation[]) {
  if (violations.length) {
    throw new DomainError(violations[0].code, violations[0].message, HttpStatus.UNPROCESSABLE_ENTITY, { violations });
  }
}

@Injectable()
export class TimeReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly schedules: ScheduleService,
  ) {}

  private today() {
    return todayIn(loadConfig().TZ_BUSINESS);
  }

  /** Day metadata for one employee: weekend/holiday/lock flags and required minutes from their work schedule. */
  private async dayFrame(employee: ScheduledEmployee, dates: string[]) {
    const months = [...new Set(dates.map(monthOf))];
    const [policy, holidays, locks, schedule] = await Promise.all([
      this.calendar.policy(),
      this.calendar.holidays(dates[0], dates[dates.length - 1]),
      this.prisma.periodLock.findMany({ where: { month: { in: months } }, select: { month: true } }),
      this.schedules.resolve([employee], dates),
    ]);
    const holidayByDate = new Map(holidays.map((h) => [h.date, h]));
    const locked = new Set(locks.map((l) => l.month));
    const perDate = schedule.get(employee.id)!;
    const days = dates.map((date) => {
      const holiday = holidayByDate.get(date);
      const scheduled = perDate.get(date)!;
      return {
        date,
        weekday: isoWeekday(date),
        weekend: isWeekend(date),
        holiday: holiday ? { minutes: holiday.minutes, description: holiday.description } : null,
        locked: locked.has(monthOf(date)),
        scheduledMinutes: scheduled.minutes,
        requiredMinutes: requiredFrom(scheduled.minutes, holiday?.minutes ?? 0),
      };
    });
    return { policy, days, scheduleName: perDate.get(dates[0])?.schedule ?? null };
  }

  private async employeeOrThrow(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, orgUnitId: true } });
    if (!employee) throw notFound('พนักงาน');
    return employee;
  }

  /** Engagement ids the employee used most recently in [from, to], newest first. */
  private async recentEngagementIds(employeeId: string, from: string, to: string, take: number) {
    const rows = await this.prisma.timeEntry.groupBy({
      by: ['engagementId'],
      where: { employeeId, deletedAt: null, workDate: { gte: toDate(from), lte: toDate(to) } },
      _max: { workDate: true },
      orderBy: { _max: { workDate: 'desc' } },
      take,
    });
    return rows.map((r) => r.engagementId);
  }

  /**
   * Everything the weekly timesheet needs in ONE round trip: day frame, entries grouped by row,
   * rows carried over from the previous 2 weeks, and recent tasks for the quick-add picker.
   */
  async week(user: AuthUser, anyDate: string, employeeId = user.id) {
    await this.access.assertCanRead(user, employeeId);
    const { monday } = weekRange(anyDate);
    const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
    const sunday = dates[6];
    const today = this.today();
    const own = employeeId === user.id;

    const employee = await this.employeeOrThrow(employeeId);
    const [frame, entries, carriedIds, recentIds] = await Promise.all([
      this.dayFrame(employee, dates),
      this.prisma.timeEntry.findMany({
        where: { employeeId, deletedAt: null, workDate: { gte: toDate(monday), lte: toDate(sunday) } },
        include: { engagement: { include: ENGAGEMENT_INCLUDE } },
      }),
      own ? this.recentEngagementIds(employeeId, addDays(monday, -14), addDays(monday, -1), 30) : Promise.resolve([]),
      own ? this.recentEngagementIds(employeeId, addDays(today, -90), today, 12) : Promise.resolve([]),
    ]);
    const rows = new Map<string, WeekRow>();
    const dayTotals = new Map<string, number>();
    for (const e of entries) {
      let row = rows.get(e.engagementId);
      if (!row) {
        row = { ...engagementDto(e.engagement), cells: {}, totalMinutes: 0, carried: false };
        rows.set(e.engagementId, row);
      }
      const dto = entryDto(e);
      row.cells[dto.workDate] = dto;
      row.totalMinutes += e.durationMinutes;
      dayTotals.set(dto.workDate, (dayTotals.get(dto.workDate) ?? 0) + e.durationMinutes);
    }

    // One extra query resolves both carried-over rows and recent tasks.
    const knownIds = [...new Set([...carriedIds, ...recentIds])];
    const known = knownIds.length
      ? await this.prisma.engagement.findMany({ where: { id: { in: knownIds } }, include: ENGAGEMENT_INCLUDE })
      : [];
    const byId = new Map(known.map((e) => [e.id, engagementDto(e)]));
    for (const id of carriedIds) {
      const eng = byId.get(id);
      if (eng?.active && !rows.has(id)) rows.set(id, { ...eng, cells: {}, totalMinutes: 0, carried: true });
    }

    const days = frame.days.map((d) => {
      const totalMinutes = dayTotals.get(d.date) ?? 0;
      return { ...d, totalMinutes, status: dayStatusFor(totalMinutes, d.requiredMinutes) };
    });

    return {
      weekStart: monday,
      weekEnd: sunday,
      today,
      employee: { id: employee.id, fullName: employee.fullName },
      scheduleName: frame.scheduleName,
      editable: own && days.some((d) => !d.locked),
      policy: frame.policy,
      days,
      rows: [...rows.values()].sort(
        (a, b) =>
          Number(a.carried) - Number(b.carried) ||
          a.customer.code.localeCompare(b.customer.code) ||
          a.workCategory.name.localeCompare(b.workCategory.name, 'th'),
      ),
      recentEngagements: recentIds.map((id) => byId.get(id)).filter((e): e is EngagementView => !!e?.active),
      totals: {
        recordedMinutes: days.reduce((a, d) => a + d.totalMinutes, 0),
        requiredMinutes: days.reduce((a, d) => a + d.requiredMinutes, 0),
      },
    };
  }

  /** Lightweight per-day totals for the month calendar (no entry rows). */
  async monthSummary(user: AuthUser, month: string, employeeId = user.id) {
    await this.access.assertCanRead(user, employeeId);
    const { from, to, days: dates } = monthRange(month);
    const employee = await this.employeeOrThrow(employeeId);
    const [frame, sums] = await Promise.all([
      this.dayFrame(employee, dates),
      this.prisma.timeEntry.groupBy({
        by: ['workDate'],
        _sum: { durationMinutes: true },
        where: { employeeId, deletedAt: null, workDate: { gte: toDate(from), lte: toDate(to) } },
      }),
    ]);
    const totals = new Map(sums.map((s) => [toIsoDate(s.workDate), s._sum.durationMinutes ?? 0]));
    const today = this.today();
    const days = frame.days.map((d) => {
      const totalMinutes = totals.get(d.date) ?? 0;
      return { ...d, totalMinutes, status: dayStatusFor(totalMinutes, d.requiredMinutes) };
    });
    const due = days.filter((d) => d.date <= today && d.requiredMinutes > 0);
    return {
      month,
      today,
      locked: days[0].locked,
      days,
      totals: {
        recordedMinutes: days.reduce((a, d) => a + d.totalMinutes, 0),
        requiredMinutes: days.reduce((a, d) => a + d.requiredMinutes, 0),
        dueDays: due.length,
        completeDueDays: due.filter((d) => d.totalMinutes >= d.requiredMinutes).length,
      },
    };
  }

  async upsert(user: AuthUser, input: UpsertEntryInput, req: AppRequest) {
    try {
      return await this.prisma.$transaction(async (tx) => this.upsertTx(tx, user, input, req));
    } catch (e) {
      // Concurrent create of the same cell hits the partial unique index.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict();
      throw e;
    }
  }

  private async upsertTx(tx: Prisma.TransactionClient, user: AuthUser, input: UpsertEntryInput, req: AppRequest) {
    const engagement = await tx.engagement.findUnique({
      where: { id: input.engagementId },
      include: ENGAGEMENT_INCLUDE,
    });
    if (!engagement) throw notFound('งาน');
    const workDate = toDate(input.workDate);
    const description = input.description?.trim() || null;

    const existing = await tx.timeEntry.findFirst({
      where: { employeeId: user.id, engagementId: input.engagementId, workDate, deletedAt: null },
    });
    if (existing && existing.durationMinutes === input.durationMinutes && existing.description === description) {
      return entryDto(existing); // idempotent retry / no-op save
    }
    if (existing && input.expectedVersion !== existing.version) throw conflict();
    if (!existing && input.expectedVersion !== undefined) throw conflict();

    const others = await tx.timeEntry.aggregate({
      _sum: { durationMinutes: true },
      where: { employeeId: user.id, workDate, deletedAt: null, ...(existing ? { id: { not: existing.id } } : {}) },
    });
    rejectIf(
      checkEntry({
        policy: await this.calendar.policy(tx),
        today: this.today(),
        workDate: input.workDate,
        durationMinutes: input.durationMinutes,
        otherMinutesSameDay: others._sum.durationMinutes ?? 0,
        periodLocked: await this.calendar.isLocked(monthOf(input.workDate), tx),
        engagementActive: engagement.isActive && engagement.customer.isActive && engagement.workCategory.isActive,
      }),
    );

    if (!existing) {
      const created = await tx.timeEntry.create({
        data: {
          employeeId: user.id,
          engagementId: input.engagementId,
          workDate,
          durationMinutes: input.durationMinutes,
          description,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await this.audit.record({ action: 'time_entry.create', resourceType: 'time_entry', resourceId: created.id, after: auditSnapshot(created) }, req, tx);
      return entryDto(created);
    }

    const { count } = await tx.timeEntry.updateMany({
      where: { id: existing.id, version: existing.version, deletedAt: null },
      data: { durationMinutes: input.durationMinutes, description, updatedById: user.id, version: { increment: 1 } },
    });
    if (count === 0) throw conflict();
    const updated = await tx.timeEntry.findUniqueOrThrow({ where: { id: existing.id } });
    await this.audit.record(
      { action: 'time_entry.update', resourceType: 'time_entry', resourceId: updated.id, before: auditSnapshot(existing), after: auditSnapshot(updated) },
      req,
      tx,
    );
    return entryDto(updated);
  }

  async remove(user: AuthUser, id: string, expectedVersion: number, req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.findFirst({ where: { id, deletedAt: null } });
      if (!entry) throw notFound('รายการ');
      if (entry.employeeId !== user.id) throw forbidden('แก้ไขได้เฉพาะรายการของตนเอง');
      const workDate = toIsoDate(entry.workDate);
      rejectIf(
        checkDelete({
          policy: await this.calendar.policy(tx),
          today: this.today(),
          workDate,
          periodLocked: await this.calendar.isLocked(monthOf(workDate), tx),
        }),
      );
      // Soft delete keeps history for audit and report reconciliation.
      const { count } = await tx.timeEntry.updateMany({
        where: { id, version: expectedVersion, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: user.id, updatedById: user.id, version: { increment: 1 } },
      });
      if (count === 0) throw conflict();
      await this.audit.record({ action: 'time_entry.delete', resourceType: 'time_entry', resourceId: id, before: auditSnapshot(entry) }, req, tx);
    });
  }

  /**
   * Weekly completeness (Mon–Sun, each person against their own schedule) for everyone in the caller's scope.
   * Replaces the legacy n8n API.
   */
  async completeness(user: AuthUser, weekOf: string) {
    const scope = await this.access.reportScope(user);
    const { monday } = weekRange(weekOf);
    const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
    const sunday = dates[6];
    const [holidayMinutes, employees, sums] = await Promise.all([
      this.calendar.holidayMinutes(monday, sunday),
      this.prisma.employee.findMany({
        where: { status: EmploymentStatus.ACTIVE, id: this.access.employeeFilter(scope) },
        select: { id: true, fullName: true, orgUnitId: true },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.timeEntry.groupBy({
        by: ['employeeId'],
        _sum: { durationMinutes: true },
        where: { deletedAt: null, workDate: { gte: toDate(monday), lte: toDate(sunday) }, employeeId: this.access.employeeFilter(scope) },
      }),
    ]);
    const required = await this.schedules.required(employees, dates, holidayMinutes);
    const recordedBy = new Map(sums.map((s) => [s.employeeId, s._sum.durationMinutes ?? 0]));
    return {
      weekStart: monday,
      weekEnd: sunday,
      employees: employees.map((e) => {
        const recorded = recordedBy.get(e.id) ?? 0;
        const req = [...(required.get(e.id)?.values() ?? [])].reduce((a, b) => a + b, 0);
        return { id: e.id, fullName: e.fullName, requiredMinutes: req, recordedMinutes: recorded, missingMinutes: Math.max(0, req - recorded), complete: recorded >= req };
      }),
    };
  }
}
