import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isoWeekday, toDate, toIsoDate } from '../../common/dates';
import { PrismaService } from '../../common/prisma.service';
import { requiredFrom } from '../time-report/policy';

type Db = PrismaService | Prisma.TransactionClient;

export interface ScheduledEmployee {
  id: string;
  orgUnitId: string | null;
}

interface Assignment {
  employeeId: string | null;
  orgUnitId: string | null;
  from: string;
  to: string | null;
  minutes: number[];
  scheduleName: string;
}

/**
 * Resolves the expected minutes per employee per date from effective-dated schedule assignments.
 * Priority on each date: the employee's own assignment > their org unit's (nearest ancestor wins) > company default.
 * Within the same scope the most recent `effectiveFrom` wins (overlaps are also prevented by a DB constraint).
 */
@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(employees: ScheduledEmployee[], dates: string[], db: Db = this.prisma) {
    const from = dates[0];
    const to = dates[dates.length - 1];
    const [rows, units] = await Promise.all([
      db.scheduleAssignment.findMany({
        where: {
          effectiveFrom: { lte: toDate(to) },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(from) } }],
        },
        include: { schedule: { select: { weekdayMinutes: true, name: true } } },
        orderBy: { effectiveFrom: 'desc' },
      }),
      db.orgUnit.findMany({ select: { id: true, parentId: true } }),
    ]);
    const assignments: Assignment[] = rows.map((r) => ({
      employeeId: r.employeeId,
      orgUnitId: r.orgUnitId,
      from: toIsoDate(r.effectiveFrom),
      to: r.effectiveTo ? toIsoDate(r.effectiveTo) : null,
      minutes: r.schedule.weekdayMinutes,
      scheduleName: r.schedule.name,
    }));
    const parentOf = new Map(units.map((u) => [u.id, u.parentId]));
    const activeOn = (list: Assignment[], date: string) => list.find((a) => a.from <= date && (a.to === null || a.to >= date));

    const byEmployee = new Map<string, Assignment[]>();
    const byUnit = new Map<string, Assignment[]>();
    const defaults: Assignment[] = [];
    for (const a of assignments) {
      if (a.employeeId) byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) ?? []), a]);
      else if (a.orgUnitId) byUnit.set(a.orgUnitId, [...(byUnit.get(a.orgUnitId) ?? []), a]);
      else defaults.push(a);
    }

    const result = new Map<string, Map<string, { minutes: number; schedule: string | null }>>();
    for (const e of employees) {
      const perDate = new Map<string, { minutes: number; schedule: string | null }>();
      for (const date of dates) {
        let hit = activeOn(byEmployee.get(e.id) ?? [], date);
        for (let unit = e.orgUnitId, guard = 0; !hit && unit && guard < 50; unit = parentOf.get(unit) ?? null, guard++) {
          hit = activeOn(byUnit.get(unit) ?? [], date);
        }
        hit ??= activeOn(defaults, date);
        perDate.set(date, { minutes: hit ? hit.minutes[isoWeekday(date) - 1] ?? 0 : 0, schedule: hit?.scheduleName ?? null });
      }
      result.set(e.id, perDate);
    }
    return result;
  }

  /** Required minutes after holidays, for many employees at once (reports, completeness). */
  async required(employees: ScheduledEmployee[], dates: string[], holidayMinutes: Map<string, number>, db: Db = this.prisma) {
    const resolved = await this.resolve(employees, dates, db);
    const out = new Map<string, Map<string, number>>();
    for (const [employeeId, perDate] of resolved) {
      out.set(employeeId, new Map([...perDate].map(([d, s]) => [d, requiredFrom(s.minutes, holidayMinutes.get(d) ?? 0)])));
    }
    return out;
  }
}
