import { HttpStatus, Injectable } from '@nestjs/common';
import { EmploymentStatus, Prisma, TodoItem, TodoPriority, TodoStatus } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, monthOf, todayIn, toDate, toIsoDate, weekRange } from '../../common/dates';
import { conflict, DomainError, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AccessService } from '../authorization/access.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CalendarService } from '../calendar/calendar.service';
import { ScheduleService } from '../calendar/schedule.service';
import { CostService } from '../reports/cost.service';
import { ENGAGEMENT_INCLUDE, engagementDto, TimeReportService } from '../time-report/time-report.service';

/** How far plans may reach: a little back (catch-up), well ahead (planning a closing season). */
export const PLAN_BACK_DAYS = 31;
export const PLAN_AHEAD_DAYS = 180;
const OPEN: TodoStatus[] = [TodoStatus.PLANNED, TodoStatus.IN_PROGRESS];

/**
 * Two kinds of item:
 *  - task item:   engagementId + plannedMinutes → the estimate (counted in hours, cost, team views)
 *  - custom item: free-text title, minutes optional → a personal note, never counted anywhere
 */
export interface TodoInput {
  employeeId?: string;
  engagementId?: string;
  title?: string;
  workDate: string;
  plannedMinutes?: number | null;
  note?: string | null;
  priority?: TodoPriority;
}

export interface TodoPatch {
  expectedVersion: number;
  title?: string;
  workDate?: string;
  plannedMinutes?: number | null;
  note?: string | null;
  priority?: TodoPriority;
  status?: TodoStatus;
}

type ItemWithRefs = Prisma.TodoItemGetPayload<{ include: { engagement: { include: typeof ENGAGEMENT_INCLUDE }; createdBy: { select: { id: true; fullName: true; nickname: true } } } }>;

const snapshot = (t: TodoItem) => ({
  employeeId: t.employeeId,
  engagementId: t.engagementId,
  title: t.title,
  workDate: toIsoDate(t.workDate),
  plannedMinutes: t.plannedMinutes,
  note: t.note,
  priority: t.priority,
  status: t.status,
  version: t.version,
});

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Task items only — what estimates, cost and team views count. */
const COUNTED: Prisma.TodoItemWhereInput = { engagementId: { not: null } };

@Injectable()
export class TodosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly calendar: CalendarService,
    private readonly schedules: ScheduleService,
    private readonly timeReport: TimeReportService,
    private readonly cost: CostService,
  ) {}

  private today() {
    return todayIn(loadConfig().TZ_BUSINESS);
  }

  /** Custom items are private: the assignee and whoever wrote them. Task items follow the normal report scope. */
  private visibleTo(user: AuthUser): Prisma.TodoItemWhereInput {
    return { OR: [COUNTED, { createdById: user.id }, { employeeId: user.id }] };
  }

  private canSee(user: AuthUser, t: Pick<TodoItem, 'engagementId' | 'createdById' | 'employeeId'>) {
    return t.engagementId !== null || t.createdById === user.id || t.employeeId === user.id;
  }

  // -------------------------------------------------------------------------
  // Who may plan for whom
  // -------------------------------------------------------------------------

  /**
   * Own plan: needs time.own.write. Someone else's: todo.assign AND that person is in the caller's
   * report scope (team they lead, or the unit their role is scoped to) AND still employed.
   */
  private async assertCanPlanFor(user: AuthUser, employeeId: string) {
    if (employeeId === user.id) {
      if (!user.permissions.includes('time.own.write')) throw forbidden();
      return;
    }
    if (!user.permissions.includes('todo.assign')) throw forbidden('มอบหมายงานได้เฉพาะหัวหน้าทีมที่มีสิทธิ์');
    const scope = await this.access.reportScope(user);
    if (!scope.all && !scope.ids.includes(employeeId)) throw forbidden('มอบหมายงานได้เฉพาะพนักงานในทีมที่คุณดูแล');
    const target = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { status: true } });
    if (!target) throw notFound('พนักงาน');
    if (target.status !== EmploymentStatus.ACTIVE) throw new DomainError('EMPLOYEE_INACTIVE', 'พนักงานคนนี้พ้นสภาพแล้ว', 422);
  }

  /**
   * Task items: same rules as time entries where they make sense for a plan (step, max length, locked months,
   * active task). Custom items: only the date window and, if hours are given, the same step and max length.
   */
  private async validate(
    tx: Prisma.TransactionClient,
    v: { engagementId: string | null; title: string | null; workDate: string; plannedMinutes: number | null },
    engagementChanged: boolean,
  ) {
    const policy = await this.calendar.policy(tx);
    const today = this.today();
    const custom = v.engagementId === null;
    if (custom && !v.title?.trim()) throw new DomainError('TITLE_REQUIRED', 'กรุณาระบุชื่องาน', 422);
    if (!custom && v.plannedMinutes === null) throw new DomainError('DURATION_INVALID', 'ชั่วโมงที่วางแผนต้องมากกว่า 0', 422);
    if (v.plannedMinutes !== null) {
      if (!Number.isInteger(v.plannedMinutes) || v.plannedMinutes <= 0) throw new DomainError('DURATION_INVALID', 'ชั่วโมงที่วางแผนต้องมากกว่า 0', 422);
      if (v.plannedMinutes % policy.incrementMinutes !== 0) {
        throw new DomainError('DURATION_INCREMENT', `ชั่วโมงต้องเป็นทวีคูณของ ${policy.incrementMinutes} นาที`, 422);
      }
      if (v.plannedMinutes > policy.maxEntryMinutes) {
        throw new DomainError('DURATION_TOO_LONG', `งานเดียวต้องไม่เกิน ${policy.maxEntryMinutes / 60} ชม. — แบ่งเป็นหลายวันแทน`, 422);
      }
    }
    if (v.workDate < addDays(today, -PLAN_BACK_DAYS)) throw new DomainError('PLAN_TOO_OLD', `วางแผนย้อนหลังได้ไม่เกิน ${PLAN_BACK_DAYS} วัน`, 422);
    if (v.workDate > addDays(today, PLAN_AHEAD_DAYS)) throw new DomainError('PLAN_TOO_FAR', `วางแผนล่วงหน้าได้ไม่เกิน ${PLAN_AHEAD_DAYS} วัน`, 422);
    if (custom) return; // personal notes are not part of any estimate → no period lock, no task checks
    // Estimates of a closed period are what the variance report is measured against — keep them fixed.
    if (await this.calendar.isLocked(monthOf(v.workDate), tx)) throw new DomainError('PERIOD_LOCKED', 'งวดนี้ถูกปิดแล้ว แก้แผนงานไม่ได้', 422);
    if (engagementChanged) {
      const e = await tx.engagement.findUnique({ where: { id: v.engagementId! }, include: ENGAGEMENT_INCLUDE });
      if (!e) throw notFound('งาน');
      if (!(e.isActive && e.customer.isActive && e.workCategory.isActive)) {
        throw new DomainError('ENGAGEMENT_INACTIVE', 'Activity นี้ถูกปิดสำหรับลูกค้ารายนี้แล้ว', 422);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** `actualMinutes` is per task and day; `taskDayPlannedMinutes` is what to compare it with when a day plans the same task twice. */
  private itemDto(t: ItemWithRefs, actualMinutes: number, taskDayPlannedMinutes: number | null, today: string) {
    const date = toIsoDate(t.workDate);
    return {
      id: t.id,
      kind: t.engagement ? ('TASK' as const) : ('CUSTOM' as const),
      task: t.engagement ? engagementDto(t.engagement) : null,
      title: t.title,
      workDate: date,
      plannedMinutes: t.plannedMinutes,
      actualMinutes,
      taskDayPlannedMinutes,
      note: t.note,
      priority: t.priority,
      status: t.status,
      late: OPEN.includes(t.status) && date < today,
      assignedBy: t.createdById !== t.employeeId ? { id: t.createdBy.id, fullName: t.createdBy.fullName, nickname: t.createdBy.nickname } : null,
      version: t.version,
    };
  }

  /** The planner for one person and one week: days (required / planned / actual), items with their actuals, optional cost. */
  async week(user: AuthUser, anyDate: string | undefined, employeeId = user.id) {
    await this.access.assertCanRead(user, employeeId);
    const { monday } = weekRange(anyDate ?? this.today());
    const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
    const sunday = dates[6];
    const today = this.today();
    const employee = await this.timeReport.employeeOrThrow(employeeId);
    const range = { gte: toDate(monday), lte: toDate(sunday) };

    const [frame, items, actuals, recent, emp, overdue] = await Promise.all([
      this.timeReport.dayFrame(employee, dates),
      this.prisma.todoItem.findMany({
        where: { employeeId, deletedAt: null, workDate: range, ...this.visibleTo(user) },
        include: { engagement: { include: ENGAGEMENT_INCLUDE }, createdBy: { select: { id: true, fullName: true, nickname: true } } },
        orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.timeEntry.groupBy({
        by: ['engagementId', 'workDate'],
        where: { employeeId, deletedAt: null, workDate: range },
        _sum: { durationMinutes: true },
      }),
      this.recentTasks(employeeId, today),
      this.prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { nickname: true, levelId: true, status: true } }),
      this.prisma.todoItem.count({
        where: {
          employeeId,
          deletedAt: null,
          status: { in: OPEN },
          workDate: { lt: toDate(monday < today ? monday : today), gte: toDate(addDays(today, -PLAN_BACK_DAYS)) },
          ...this.visibleTo(user),
        },
      }),
    ]);

    const counted = items.filter((t) => t.engagementId !== null && t.plannedMinutes !== null && t.status !== TodoStatus.CANCELLED);
    const actualBy = new Map(actuals.map((a) => [`${a.engagementId}|${toIsoDate(a.workDate)}`, a._sum.durationMinutes ?? 0]));
    const dayActual = new Map<string, number>();
    for (const a of actuals) dayActual.set(toIsoDate(a.workDate), (dayActual.get(toIsoDate(a.workDate)) ?? 0) + (a._sum.durationMinutes ?? 0));
    const taskDayPlanned = new Map<string, number>();
    const dayPlanned = new Map<string, number>();
    for (const t of counted) {
      const d = toIsoDate(t.workDate);
      taskDayPlanned.set(`${t.engagementId}|${d}`, (taskDayPlanned.get(`${t.engagementId}|${d}`) ?? 0) + t.plannedMinutes!);
      dayPlanned.set(d, (dayPlanned.get(d) ?? 0) + t.plannedMinutes!);
    }

    const own = employeeId === user.id;
    const canEdit =
      emp.status === EmploymentStatus.ACTIVE &&
      (own ? user.permissions.includes('time.own.write') : user.permissions.includes('todo.assign'));

    let cost: { planned: number; actual: number; unpricedMinutes: number } | null = null;
    if (user.permissions.includes('cost.read')) {
      const p = await this.cost.pricer([employeeId], 'AT_DATE');
      const who = { id: employeeId, levelId: emp.levelId };
      const sum = { planned: 0, actual: 0, unpricedMinutes: 0 };
      for (const t of counted) {
        const priced = p.price(who, toIsoDate(t.workDate), t.plannedMinutes!);
        if (priced.cost === null) sum.unpricedMinutes += t.plannedMinutes!;
        else sum.planned += priced.cost;
      }
      for (const a of actuals) {
        const minutes = a._sum.durationMinutes ?? 0;
        const priced = p.price(who, toIsoDate(a.workDate), minutes);
        if (priced.cost === null) sum.unpricedMinutes += minutes;
        else sum.actual += priced.cost;
      }
      cost = { planned: round2(sum.planned), actual: round2(sum.actual), unpricedMinutes: sum.unpricedMinutes };
    }

    return {
      weekStart: monday,
      weekEnd: sunday,
      today,
      employee: { id: employee.id, fullName: employee.fullName, nickname: emp.nickname },
      own,
      canEdit,
      policy: { incrementMinutes: frame.policy.incrementMinutes, maxEntryMinutes: frame.policy.maxEntryMinutes },
      days: frame.days.map((d) => ({
        date: d.date,
        weekday: d.weekday,
        weekend: d.weekend,
        holiday: d.holiday,
        locked: d.locked,
        requiredMinutes: d.requiredMinutes,
        plannedMinutes: dayPlanned.get(d.date) ?? 0,
        actualMinutes: dayActual.get(d.date) ?? 0,
      })),
      items: items.map((t) => {
        if (!t.engagementId) return this.itemDto(t, 0, null, today);
        const k = `${t.engagementId}|${toIsoDate(t.workDate)}`;
        return this.itemDto(t, actualBy.get(k) ?? 0, taskDayPlanned.get(k) ?? t.plannedMinutes, today);
      }),
      overdue,
      recentTasks: recent,
      cost,
    };
  }

  /** Tasks the person planned or logged lately — the picker's first page. */
  private async recentTasks(employeeId: string, today: string) {
    const from = toDate(addDays(today, -60));
    const [planned, logged] = await Promise.all([
      this.prisma.todoItem.groupBy({
        by: ['engagementId'],
        where: { employeeId, deletedAt: null, workDate: { gte: from }, ...COUNTED },
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: 'desc' } },
        take: 12,
      }),
      this.prisma.timeEntry.groupBy({ by: ['engagementId'], where: { employeeId, deletedAt: null, workDate: { gte: from } }, _max: { workDate: true }, orderBy: { _max: { workDate: 'desc' } }, take: 12 }),
    ]);
    const ids = [...new Set([...planned, ...logged].map((r) => r.engagementId).filter((id): id is string => !!id))].slice(0, 15);
    if (!ids.length) return [];
    const rows = await this.prisma.engagement.findMany({ where: { id: { in: ids } }, include: ENGAGEMENT_INCLUDE });
    const byId = new Map(rows.map((e) => [e.id, engagementDto(e)]));
    return ids.map((id) => byId.get(id)).filter((e): e is ReturnType<typeof engagementDto> => !!e?.active);
  }

  /** Team overview (legacy "To Do List : ทีม" / "ทั้งหมด"): planned vs required vs actual per person and day. Task items only. */
  async team(user: AuthUser, anyDate: string | undefined) {
    if (!user.permissions.includes('report.team.read') && !user.permissions.includes('report.all.read')) throw forbidden();
    const scope = await this.access.reportScope(user);
    const { monday } = weekRange(anyDate ?? this.today());
    const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
    const range = { gte: toDate(monday), lte: toDate(dates[6]) };
    const today = this.today();

    const employees = await this.prisma.employee.findMany({
      where: { status: EmploymentStatus.ACTIVE, ...(scope.all ? {} : { id: { in: scope.ids } }) },
      select: { id: true, fullName: true, nickname: true, orgUnitId: true, orgUnit: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    const ids = employees.map((e) => e.id);
    const holidays = await this.calendar.holidays(monday, dates[6]);
    const holidayMinutes = new Map(holidays.map((h) => [h.date, h.minutes]));
    const [required, planned, actual, late] = await Promise.all([
      this.schedules.required(employees, dates, holidayMinutes),
      this.prisma.todoItem.groupBy({
        by: ['employeeId', 'workDate'],
        where: { employeeId: { in: ids }, deletedAt: null, status: { not: TodoStatus.CANCELLED }, workDate: range, ...COUNTED },
        _sum: { plannedMinutes: true },
      }),
      this.prisma.timeEntry.groupBy({ by: ['employeeId', 'workDate'], where: { employeeId: { in: ids }, deletedAt: null, workDate: range }, _sum: { durationMinutes: true } }),
      this.prisma.todoItem.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: ids }, deletedAt: null, status: { in: OPEN }, workDate: { lt: toDate(today), gte: toDate(addDays(today, -PLAN_BACK_DAYS)) }, ...COUNTED },
        _count: { _all: true },
      }),
    ]);
    const key = (id: string, d: Date) => `${id}|${toIsoDate(d)}`;
    const plannedBy = new Map(planned.map((r) => [key(r.employeeId, r.workDate), r._sum.plannedMinutes ?? 0]));
    const actualBy = new Map(actual.map((r) => [key(r.employeeId, r.workDate), r._sum.durationMinutes ?? 0]));
    const lateBy = new Map(late.map((r) => [r.employeeId, r._count._all]));

    return {
      weekStart: monday,
      today,
      dates,
      canAssign: user.permissions.includes('todo.assign'),
      people: employees.map((e) => ({
        employee: { id: e.id, fullName: e.fullName, nickname: e.nickname, team: e.orgUnit?.name ?? null },
        lateItems: lateBy.get(e.id) ?? 0,
        days: dates.map((d) => ({
          date: d,
          requiredMinutes: required.get(e.id)?.get(d) ?? 0,
          plannedMinutes: plannedBy.get(`${e.id}|${d}`) ?? 0,
          actualMinutes: actualBy.get(`${e.id}|${d}`) ?? 0,
        })),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(user: AuthUser, input: TodoInput, req: AppRequest) {
    const employeeId = input.employeeId ?? user.id;
    await this.assertCanPlanFor(user, employeeId);
    const engagementId = input.engagementId ?? null;
    const title = engagementId ? null : (input.title?.trim() ?? null);
    const plannedMinutes = input.plannedMinutes ?? null;
    return this.prisma.$transaction(async (tx) => {
      await this.validate(tx, { engagementId, title, workDate: input.workDate, plannedMinutes }, true);
      const item = await tx.todoItem.create({
        data: {
          employeeId,
          engagementId,
          title,
          workDate: toDate(input.workDate),
          plannedMinutes,
          note: input.note?.trim() || null,
          priority: input.priority ?? TodoPriority.MEDIUM,
          createdById: user.id,
        },
      });
      await this.audit.record({ action: 'todo.create', resourceType: 'todo_item', resourceId: item.id, after: snapshot(item) }, req, tx);
      return { id: item.id, version: item.version };
    });
  }

  /**
   * The assignee updates progress on anything in their plan; whoever may plan for them (themselves or
   * their lead) edits the rest. An assignee cannot delete work their lead assigned — they cancel it,
   * so the lead still sees it. The kind (task / custom) cannot change.
   */
  async update(user: AuthUser, id: string, patch: TodoPatch, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.todoItem.findFirst({ where: { id, deletedAt: null } });
      if (!before || !this.canSee(user, before)) throw notFound('งาน');
      await this.assertCanPlanFor(user, before.employeeId);
      if (before.version !== patch.expectedVersion) throw conflict();
      const custom = before.engagementId === null;
      if (!custom && patch.title !== undefined) throw new DomainError('NOT_CUSTOM', 'เปลี่ยนชื่อได้เฉพาะงานอื่นที่สร้างเอง', 422);

      const next = {
        engagementId: before.engagementId,
        title: custom ? (patch.title?.trim() ?? before.title) : null,
        workDate: patch.workDate ?? toIsoDate(before.workDate),
        plannedMinutes: patch.plannedMinutes === undefined ? before.plannedMinutes : patch.plannedMinutes,
      };
      const planChanged = patch.workDate !== undefined || patch.plannedMinutes !== undefined || patch.title !== undefined;
      if (planChanged) {
        // A task item in a locked month keeps its estimate (and cannot be moved out of it either).
        if (!custom && (await this.calendar.isLocked(monthOf(toIsoDate(before.workDate)), tx))) {
          throw new DomainError('PERIOD_LOCKED', 'งวดนี้ถูกปิดแล้ว แก้แผนงานไม่ได้', 422);
        }
        await this.validate(tx, next, false);
      }
      const status = patch.status ?? before.status;
      const { count } = await tx.todoItem.updateMany({
        where: { id, version: before.version, deletedAt: null },
        data: {
          title: next.title,
          workDate: toDate(next.workDate),
          plannedMinutes: next.plannedMinutes,
          ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
          ...(patch.priority ? { priority: patch.priority } : {}),
          status,
          completedAt: status === TodoStatus.DONE ? (before.completedAt ?? new Date()) : null,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw conflict();
      const after = await tx.todoItem.findUniqueOrThrow({ where: { id } });
      await this.audit.record({ action: 'todo.update', resourceType: 'todo_item', resourceId: id, before: snapshot(before), after: snapshot(after) }, req, tx);
      return { id, version: after.version, status: after.status };
    });
  }

  async remove(user: AuthUser, id: string, expectedVersion: number, req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.todoItem.findFirst({ where: { id, deletedAt: null } });
      if (!item || !this.canSee(user, item)) throw notFound('งาน');
      await this.assertCanPlanFor(user, item.employeeId);
      if (item.createdById !== item.employeeId && user.id === item.employeeId) {
        throw new DomainError('ASSIGNED_BY_LEAD', 'งานนี้หัวหน้ามอบหมาย — เปลี่ยนสถานะเป็น “ยกเลิก” แทนการลบ', HttpStatus.FORBIDDEN);
      }
      if (item.engagementId && (await this.calendar.isLocked(monthOf(toIsoDate(item.workDate)), tx))) {
        throw new DomainError('PERIOD_LOCKED', 'งวดนี้ถูกปิดแล้ว แก้แผนงานไม่ได้', 422);
      }
      const { count } = await tx.todoItem.updateMany({ where: { id, version: expectedVersion, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      if (count === 0) throw conflict();
      await this.audit.record({ action: 'todo.delete', resourceType: 'todo_item', resourceId: id, before: snapshot(item) }, req, tx);
    });
  }

  /** Move unfinished work from past days to a target day (legacy marked it "ล่าช้า" and left it behind). */
  async carryOver(user: AuthUser, toDateIso: string, employeeId = user.id, req: AppRequest) {
    await this.assertCanPlanFor(user, employeeId);
    const today = this.today();
    if (toDateIso < today) throw new DomainError('CARRY_TO_PAST', 'ย้ายงานค้างได้เฉพาะไปวันนี้หรือวันถัดไป', 422);
    if (toDateIso > addDays(today, PLAN_AHEAD_DAYS)) throw new DomainError('PLAN_TOO_FAR', `วางแผนล่วงหน้าได้ไม่เกิน ${PLAN_AHEAD_DAYS} วัน`, 422);
    return this.prisma.$transaction(async (tx) => {
      const targetLocked = await this.calendar.isLocked(monthOf(toDateIso), tx);
      const open = await tx.todoItem.findMany({
        where: {
          employeeId,
          deletedAt: null,
          status: { in: OPEN },
          workDate: { lt: toDate(today), gte: toDate(addDays(today, -PLAN_BACK_DAYS)) },
          ...this.visibleTo(user),
        },
      });
      // Task items in a locked month (or going into one) stay where they are; custom notes always move.
      const lockedMonths = new Set<string>();
      for (const m of new Set(open.map((t) => monthOf(toIsoDate(t.workDate))))) if (await this.calendar.isLocked(m, tx)) lockedMonths.add(m);
      const movable = open.filter((t) => !t.engagementId || (!targetLocked && !lockedMonths.has(monthOf(toIsoDate(t.workDate)))));
      if (!movable.length) return { moved: 0, skippedLocked: open.length };
      await tx.todoItem.updateMany({ where: { id: { in: movable.map((t) => t.id) } }, data: { workDate: toDate(toDateIso), version: { increment: 1 } } });
      await this.audit.record(
        { action: 'todo.carry_over', resourceType: 'todo_item', after: { employeeId, to: toDateIso, items: movable.map((t) => ({ id: t.id, from: toIsoDate(t.workDate) })) } },
        req,
        tx,
      );
      return { moved: movable.length, skippedLocked: open.length - movable.length };
    });
  }
}
