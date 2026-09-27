import { Injectable } from '@nestjs/common';
import { AppKind } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, isoWeekday, monthOf, toDate, toIsoDate, todayIn, weekRange } from '../../common/dates';
import { PrismaService } from '../../common/prisma.service';
import { AccessService } from '../authorization/access.service';
import type { AuthUser } from '../auth/auth.types';
import { CalendarService } from '../calendar/calendar.service';
import { ScheduleService } from '../calendar/schedule.service';
import { dayStatusFor } from '../time-report/policy';

export type AttentionItem =
  | { kind: 'TIME_MISSING'; id: string; date: string; missingMinutes: number; href: string }
  | { kind: 'ACK_REQUIRED'; id: string; announcementId: string; title: string; publishedAt: Date; href: string }
  | { kind: 'TEAM_INCOMPLETE'; id: string; weekStart: string; incomplete: number; total: number; href: string };

const LOOKBACK_DAYS = 14;

@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
    private readonly schedules: ScheduleService,
    private readonly access: AccessService,
  ) {}

  private today() {
    return todayIn(loadConfig().TZ_BUSINESS);
  }

  /** Recorded vs required per date for one employee. */
  private async progress(employee: { id: string; orgUnitId: string | null }, dates: string[]) {
    const [holidays, sums, locks] = await Promise.all([
      this.calendar.holidayMinutes(dates[0], dates[dates.length - 1]),
      this.prisma.timeEntry.groupBy({
        by: ['workDate'],
        _sum: { durationMinutes: true },
        where: { employeeId: employee.id, deletedAt: null, workDate: { gte: toDate(dates[0]), lte: toDate(dates[dates.length - 1]) } },
      }),
      this.prisma.periodLock.findMany({ where: { month: { in: [...new Set(dates.map(monthOf))] } }, select: { month: true } }),
    ]);
    const required = (await this.schedules.required([employee], dates, holidays)).get(employee.id)!;
    const recorded = new Map(sums.map((s) => [toIsoDate(s.workDate), s._sum.durationMinutes ?? 0]));
    const locked = new Set(locks.map((l) => l.month));
    return dates.map((date) => {
      const req = required.get(date) ?? 0;
      const total = recorded.get(date) ?? 0;
      return { date, weekday: isoWeekday(date), requiredMinutes: req, totalMinutes: total, status: dayStatusFor(total, req), locked: locked.has(monthOf(date)) };
    });
  }

  /** Everything that needs the user's action, newest first. Derived on read — no notification table to go stale. */
  async attention(user: AuthUser): Promise<AttentionItem[]> {
    const today = this.today();
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, orgUnitId: true, startDate: true } });
    const past = Array.from({ length: LOOKBACK_DAYS }, (_, i) => addDays(today, -LOOKBACK_DAYS + i)); // up to yesterday

    const [days, unacked, team] = await Promise.all([
      this.progress(employee, past),
      this.prisma.announcement.findMany({
        where: {
          requiresAck: true,
          acks: { none: { employeeId: user.id } },
          // Legacy rule: only people employed when it was published need to acknowledge it.
          ...(employee.startDate ? { publishedAt: { gte: employee.startDate } } : {}),
        },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        select: { id: true, title: true, publishedAt: true },
      }),
      this.teamLastWeek(user, today),
    ]);

    const items: AttentionItem[] = [];
    for (const d of days.filter((d) => !d.locked && d.requiredMinutes > 0 && d.totalMinutes < d.requiredMinutes).reverse()) {
      items.push({ kind: 'TIME_MISSING', id: `time-${d.date}`, date: d.date, missingMinutes: d.requiredMinutes - d.totalMinutes, href: `/time-report?date=${d.date}` });
    }
    for (const a of unacked) {
      items.push({ kind: 'ACK_REQUIRED', id: `ack-${a.id}`, announcementId: a.id, title: a.title, publishedAt: a.publishedAt, href: `/announcements#${a.id}` });
    }
    if (team && team.incomplete > 0) items.push({ kind: 'TEAM_INCOMPLETE', id: `team-${team.weekStart}`, ...team, href: '/reports' });
    return items;
  }

  /** Managers/partners: how many people in their scope did not complete last week. */
  private async teamLastWeek(user: AuthUser, today: string) {
    if (!user.permissions.includes('report.team.read') && !user.permissions.includes('report.all.read')) return null;
    const scope = await this.access.reportScope(user);
    const { monday } = weekRange(addDays(today, -7));
    const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
    const [employees, holidays, sums] = await Promise.all([
      this.prisma.employee.findMany({ where: { status: 'ACTIVE', id: this.access.employeeFilter(scope), NOT: { id: user.id } }, select: { id: true, orgUnitId: true } }),
      this.calendar.holidayMinutes(dates[0], dates[6]),
      this.prisma.timeEntry.groupBy({
        by: ['employeeId'],
        _sum: { durationMinutes: true },
        where: { deletedAt: null, workDate: { gte: toDate(dates[0]), lte: toDate(dates[6]) }, employeeId: this.access.employeeFilter(scope) },
      }),
    ]);
    if (!employees.length) return null;
    const required = await this.schedules.required(employees, dates, holidays);
    const recorded = new Map(sums.map((s) => [s.employeeId, s._sum.durationMinutes ?? 0]));
    const incomplete = employees.filter((e) => (recorded.get(e.id) ?? 0) < [...(required.get(e.id)?.values() ?? [])].reduce((a, b) => a + b, 0)).length;
    return { weekStart: monday, incomplete, total: employees.length };
  }

  async apps(user: AuthUser) {
    const rows = await this.prisma.appLink.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return rows
      .filter((a) => !a.requiredPermission || user.permissions.includes(a.requiredPermission as never))
      .map(({ id, key, name, description, url, icon, kind, category }) => ({ id, key, name, description, url: kind === AppKind.PLANNED ? null : url, icon, kind, category }));
  }

  /** The whole homepage in one request. */
  async home(user: AuthUser) {
    const today = this.today();
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        fullName: true,
        nickname: true,
        email: true,
        orgUnitId: true,
        orgUnit: { select: { name: true } },
        level: { select: { name: true } },
        roleAssignments: { select: { role: { select: { name: true } }, orgUnit: { select: { name: true } } } },
      },
    });
    const { monday } = weekRange(today);
    const weekDates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthDates: string[] = [];
    for (let d = monthStart; d <= today; d = addDays(d, 1)) monthDates.push(d);

    const [week, month, attention, announcements, apps] = await Promise.all([
      this.progress(employee, weekDates),
      this.progress(employee, monthDates),
      this.attention(user),
      this.prisma.announcement.findMany({
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        take: 4,
        select: { id: true, title: true, body: true, pinned: true, requiresAck: true, publishedAt: true, author: { select: { fullName: true } }, acks: { where: { employeeId: user.id }, select: { ackAt: true } } },
      }),
      this.apps(user),
    ]);
    const sum = (rows: { totalMinutes: number; requiredMinutes: number }[], k: 'totalMinutes' | 'requiredMinutes') => rows.reduce((a, r) => a + r[k], 0);
    const due = month.filter((d) => d.requiredMinutes > 0);

    return {
      today,
      profile: {
        fullName: employee.fullName,
        nickname: employee.nickname,
        email: employee.email,
        orgUnit: employee.orgUnit?.name ?? null,
        level: employee.level?.name ?? null,
        roles: employee.roleAssignments.map((a) => (a.orgUnit ? `${a.role.name} · ${a.orgUnit.name}` : a.role.name)),
      },
      week: { weekStart: monday, days: week, recordedMinutes: sum(week, 'totalMinutes'), requiredMinutes: sum(week, 'requiredMinutes') },
      monthToDate: {
        recordedMinutes: sum(month, 'totalMinutes'),
        requiredMinutes: sum(month, 'requiredMinutes'),
        dueDays: due.length,
        completeDays: due.filter((d) => d.totalMinutes >= d.requiredMinutes).length,
      },
      attention,
      announcements: announcements.map(({ acks, author, body, ...a }) => ({
        ...a,
        author: author.fullName,
        excerpt: body.length > 180 ? `${body.slice(0, 180)}…` : body,
        ackedAt: acks[0]?.ackAt ?? null,
      })),
      apps,
    };
  }
}
