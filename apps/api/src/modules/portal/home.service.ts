import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppKind } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, isoWeekday, monthOf, toDate, toIsoDate, todayIn, weekRange } from '../../common/dates';
import { DomainError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AccessService } from '../authorization/access.service';
import type { AuthUser } from '../auth/auth.types';
import { CalendarService } from '../calendar/calendar.service';
import { ScheduleService } from '../calendar/schedule.service';
import { dayStatusFor } from '../time-report/policy';
import { MeetingAttention, MeetingsService } from '../meetings/meetings.service';
import { RequestsService } from '../assets/requests.service';
import { LeaveService } from '../leave/leave.service';

export type AttentionItem =
  | { kind: 'TIME_MISSING'; id: string; date: string; missingMinutes: number; href: string }
  | { kind: 'ACK_REQUIRED'; id: string; announcementId: string; title: string; publishedAt: Date; href: string }
  | { kind: 'TEAM_INCOMPLETE'; id: string; weekStart: string; incomplete: number; total: number; href: string }
  | { kind: 'IT_REQUESTS'; id: string; count: number; href: string }
  | { kind: 'LEAVE_APPROVALS'; id: string; count: number; href: string }
  | MeetingAttention;

const LOOKBACK_DAYS = 14;

/**
 * One section failing (a module bug, a slow query, an integration down) must not take the whole home page or the
 * notification bell with it: the section is left out and logged, the rest still renders.
 */
async function soft<T>(log: Logger, part: string, work: Promise<T>, fallback: T, degraded?: string[]): Promise<T> {
  try {
    return await work;
  } catch (e) {
    log.warn(`${part} unavailable: ${(e as Error).message}`);
    degraded?.push(part);
    return fallback;
  }
}

@Injectable()
export class HomeService {
  private readonly log = new Logger('Home');

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
    private readonly schedules: ScheduleService,
    private readonly access: AccessService,
    private readonly meetings: MeetingsService,
    private readonly requests: RequestsService,
    private readonly leave: LeaveService,
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

    const log = this.log;
    const [days, unacked, team, meetingItems, itWaiting, leaveWaiting] = await Promise.all([
      soft(log, 'time', this.progress(employee, past), []),
      soft(log, 'announcements', this.prisma.announcement.findMany({
        where: {
          requiresAck: true,
          acks: { none: { employeeId: user.id } },
          // Legacy rule: only people employed when it was published need to acknowledge it.
          ...(employee.startDate ? { publishedAt: { gte: employee.startDate } } : {}),
        },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        select: { id: true, title: true, publishedAt: true },
      }), []),
      soft(log, 'team', this.teamLastWeek(user, today), null),
      soft(log, 'meetings', this.meetings.attention(user), []),
      soft(log, 'it-requests', user.permissions.includes('asset.write') ? this.requests.waiting() : Promise.resolve(0), 0),
      soft(log, 'leave', this.leave.attentionCount(user), 0),
    ]);

    // Meeting minutes first: certifying is the item people most often forget.
    const items: AttentionItem[] = [...meetingItems];
    for (const d of days.filter((d) => !d.locked && d.requiredMinutes > 0 && d.totalMinutes < d.requiredMinutes).reverse()) {
      items.push({ kind: 'TIME_MISSING', id: `time-${d.date}`, date: d.date, missingMinutes: d.requiredMinutes - d.totalMinutes, href: `/time-report?date=${d.date}` });
    }
    for (const a of unacked) {
      items.push({ kind: 'ACK_REQUIRED', id: `ack-${a.id}`, announcementId: a.id, title: a.title, publishedAt: a.publishedAt, href: `/announcements#${a.id}` });
    }
    if (team && team.incomplete > 0) items.push({ kind: 'TEAM_INCOMPLETE', id: `team-${team.weekStart}`, ...team, href: '/reports' });
    if (itWaiting > 0) items.push({ kind: 'IT_REQUESTS', id: `it-requests-${itWaiting}`, count: itWaiting, href: '/it-assets?tab=requests' });
    // Approving leave is time-critical (it may start tomorrow) — first in the list.
    if (leaveWaiting > 0) items.unshift({ kind: 'LEAVE_APPROVALS', id: `leave-approvals-${leaveWaiting}`, count: leaveWaiting, href: '/leave?tab=approvals' });
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

  /**
   * Apps this user may see — the sidebar, the launcher and the command palette all read this list.
   * An app needs ANY of its required permissions (empty = everyone). `favorite` = position in the user's
   * pinned list (null = not pinned).
   */
  async apps(user: AuthUser) {
    const [rows, favorites] = await Promise.all([
      this.prisma.appLink.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.appFavorite.findMany({ where: { employeeId: user.id }, select: { appLinkId: true, sortOrder: true } }),
    ]);
    const pinned = new Map(favorites.map((f) => [f.appLinkId, f.sortOrder]));
    return rows
      .filter((a) => this.canSee(user, a.requiredPermissions))
      .map(({ id, key, name, description, url, icon, kind, category, isAdmin }) => ({
        id,
        key,
        name,
        description,
        url: kind === AppKind.PLANNED ? null : url,
        icon,
        kind,
        category,
        isAdmin,
        favorite: pinned.get(id) ?? null,
      }));
  }

  private canSee(user: AuthUser, required: string[]) {
    return !required.length || required.some((p) => user.permissions.includes(p as never));
  }

  /** Replaces the user's pinned apps with `keys`, in that order. Unknown, hidden or planned apps are refused. */
  async setFavorites(user: AuthUser, keys: string[]) {
    const unique = [...new Set(keys)];
    const rows = await this.prisma.appLink.findMany({ where: { key: { in: unique }, isActive: true } });
    const usable = new Map(rows.filter((a) => a.kind !== AppKind.PLANNED && this.canSee(user, a.requiredPermissions)).map((a) => [a.key, a.id]));
    const refused = unique.filter((k) => !usable.has(k));
    if (refused.length) throw new DomainError('UNKNOWN_APP', 'ไม่พบแอปที่เลือก หรือไม่มีสิทธิ์ใช้', HttpStatus.BAD_REQUEST, { keys: refused });
    await this.prisma.$transaction([
      this.prisma.appFavorite.deleteMany({ where: { employeeId: user.id } }),
      this.prisma.appFavorite.createMany({ data: unique.map((k, i) => ({ employeeId: user.id, appLinkId: usable.get(k)!, sortOrder: i })) }),
    ]);
    return this.apps(user);
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

    const degraded: string[] = [];
    const log = this.log;
    const [week, month, attention, announcements, apps] = await Promise.all([
      soft(log, 'week', this.progress(employee, weekDates), [], degraded),
      soft(log, 'month', this.progress(employee, monthDates), [], degraded),
      soft(log, 'attention', this.attention(user), [], degraded),
      soft(log, 'announcements', this.prisma.announcement.findMany({
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        take: 4,
        select: { id: true, title: true, body: true, pinned: true, requiresAck: true, publishedAt: true, author: { select: { fullName: true } }, acks: { where: { employeeId: user.id }, select: { ackAt: true } } },
      }), [], degraded),
      soft(log, 'apps', this.apps(user), [], degraded),
    ]);
    const sum = (rows: { totalMinutes: number; requiredMinutes: number }[], k: 'totalMinutes' | 'requiredMinutes') => rows.reduce((a, r) => a + r[k], 0);
    const due = month.filter((d) => d.requiredMinutes > 0);

    return {
      today,
      /** Sections that could not be loaded this time (left out, the rest of the page still works). */
      degraded,
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
