import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, RateUnit, WorkCategoryType } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, toDate, toIsoDate, todayIn } from '../../common/dates';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AccessService } from '../authorization/access.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';

type Tx = Prisma.TransactionClient;

/** Rates in the legacy member_level table. Their unit (per hour or per day) is unconfirmed — docs/06 Q5. */
export const LEGACY_RATES: Record<string, number> = { J: 1000, SS: 2000, S: 4000, M: 6000, SM: 10000, D: 20000 };

/**
 * Which level prices an hour:
 *  CURRENT — the person's level today (what the legacy report did; a promotion re-prices the past)
 *  AT_DATE — the level they held on the day of the work (level history)
 */
export type LevelBasis = 'CURRENT' | 'AT_DATE';

export interface RateInput {
  levelId: string;
  amount: number;
  unit: RateUnit;
  minutesPerDay?: number;
  effectiveFrom: string;
}

interface RatePeriod {
  amount: number;
  unit: RateUnit;
  minutesPerDay: number;
  from: string;
  to: string | null;
}

const within = (d: string, p: { from: string; to: string | null }) => p.from <= d && (!p.to || d <= p.to);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function priceOf(minutes: number, rate: Pick<RatePeriod, 'amount' | 'unit' | 'minutesPerDay'>) {
  return rate.unit === RateUnit.HOUR ? (rate.amount * minutes) / 60 : (rate.amount * minutes) / rate.minutesPerDay;
}

@Injectable()
export class CostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private today() {
    return todayIn(loadConfig().TZ_BUSINESS);
  }

  // -------------------------------------------------------------------------
  // Rates
  // -------------------------------------------------------------------------

  async rates() {
    const levels = await this.prisma.employeeLevel.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { costRates: { orderBy: { effectiveFrom: 'desc' } }, _count: { select: { employees: { where: { status: 'ACTIVE' } } } } },
    });
    const today = this.today();
    return {
      today,
      legacy: LEGACY_RATES,
      levels: levels.map((l) => {
        const periods = l.costRates.map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          unit: r.unit,
          minutesPerDay: r.minutesPerDay,
          effectiveFrom: toIsoDate(r.effectiveFrom),
          effectiveTo: r.effectiveTo ? toIsoDate(r.effectiveTo) : null,
        }));
        return {
          id: l.id,
          code: l.code,
          name: l.name,
          activeEmployees: l._count.employees,
          current: periods.find((p) => within(today, { from: p.effectiveFrom, to: p.effectiveTo })) ?? null,
          periods,
        };
      }),
    };
  }

  /** New rate from a date on; the previous one ends the day before. Same start date = correction in place. */
  private async setRate(tx: Tx, input: RateInput) {
    const open = await tx.costRate.findFirst({ where: { levelId: input.levelId, effectiveTo: null } });
    const data = { amount: input.amount, unit: input.unit, minutesPerDay: input.minutesPerDay ?? 540 };
    if (open) {
      const openFrom = toIsoDate(open.effectiveFrom);
      if (input.effectiveFrom < openFrom) {
        throw new DomainError('RATE_DATE_BEFORE_CURRENT', `วันที่มีผลต้องไม่ก่อนอัตราปัจจุบัน (เริ่ม ${openFrom})`, HttpStatus.CONFLICT);
      }
      if (input.effectiveFrom === openFrom) return tx.costRate.update({ where: { id: open.id }, data });
      await tx.costRate.update({ where: { id: open.id }, data: { effectiveTo: toDate(addDays(input.effectiveFrom, -1)) } });
    }
    return tx.costRate.create({ data: { ...data, levelId: input.levelId, effectiveFrom: toDate(input.effectiveFrom) } });
  }

  async addRate(input: RateInput, req: AppRequest) {
    if (!(await this.prisma.employeeLevel.findUnique({ where: { id: input.levelId } }))) throw notFound('ระดับ');
    return this.prisma.$transaction(async (tx) => {
      const r = await this.setRate(tx, input);
      await this.audit.record({ action: 'cost_rate.set', resourceType: 'cost_rate', resourceId: r.id, after: input }, req, tx);
      return { id: r.id };
    });
  }

  /** One click: the legacy member_level amounts, with the unit the business picks. */
  async importLegacy(input: { unit: RateUnit; effectiveFrom: string; minutesPerDay?: number }, req: AppRequest) {
    const levels = await this.prisma.employeeLevel.findMany({ where: { code: { in: Object.keys(LEGACY_RATES) } } });
    return this.prisma.$transaction(async (tx) => {
      for (const l of levels) await this.setRate(tx, { levelId: l.id, amount: LEGACY_RATES[l.code], unit: input.unit, minutesPerDay: input.minutesPerDay, effectiveFrom: input.effectiveFrom });
      await this.audit.record({ action: 'cost_rate.import_legacy', resourceType: 'cost_rate', after: { ...input, levels: levels.map((l) => l.code) } }, req, tx);
      return { levels: levels.length };
    });
  }

  // -------------------------------------------------------------------------
  // Cost report (legacy report_job.php + j_query.php?com_, with one formula)
  // -------------------------------------------------------------------------

  private async loadEntries(user: AuthUser, from: string, to: string, where: Prisma.TimeEntryWhereInput = {}) {
    const scope = await this.access.reportScope(user);
    return this.prisma.timeEntry.findMany({
      where: { deletedAt: null, workDate: { gte: toDate(from), lte: toDate(to) }, employeeId: this.access.employeeFilter(scope), ...where },
      orderBy: [{ workDate: 'asc' }],
      select: {
        id: true,
        workDate: true,
        durationMinutes: true,
        employee: { select: { id: true, fullName: true, nickname: true, levelId: true } },
        engagement: {
          select: {
            workCategory: { select: { name: true, type: true } },
            customer: { select: { id: true, code: true, name: true, accountOwner: { select: { fullName: true } } } },
          },
        },
      },
    });
  }

  /** Prices each entry. Unpriced = no level, or no rate for that level on that day. */
  async pricer(employeeIds: string[], basis: LevelBasis) {
    const [levels, rates, history] = await Promise.all([
      this.prisma.employeeLevel.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, name: true } }),
      this.prisma.costRate.findMany(),
      basis === 'AT_DATE' ? this.prisma.employeeLevelHistory.findMany({ where: { employeeId: { in: employeeIds } } }) : Promise.resolve([]),
    ]);
    const codeOf = new Map(levels.map((l) => [l.id, l.code]));
    const ratesByLevel = new Map<string, RatePeriod[]>();
    for (const r of rates) {
      const list = ratesByLevel.get(r.levelId) ?? [];
      list.push({ amount: Number(r.amount), unit: r.unit, minutesPerDay: r.minutesPerDay, from: toIsoDate(r.effectiveFrom), to: r.effectiveTo ? toIsoDate(r.effectiveTo) : null });
      ratesByLevel.set(r.levelId, list);
    }
    const historyBy = new Map<string, { levelId: string; from: string; to: string | null }[]>();
    for (const h of history) {
      const list = historyBy.get(h.employeeId) ?? [];
      list.push({ levelId: h.levelId, from: toIsoDate(h.effectiveFrom), to: h.effectiveTo ? toIsoDate(h.effectiveTo) : null });
      historyBy.set(h.employeeId, list);
    }
    const levelAt = (employee: { id: string; levelId: string | null }, date: string) =>
      basis === 'CURRENT' ? employee.levelId : (historyBy.get(employee.id)?.find((p) => within(date, p))?.levelId ?? null);

    return {
      levels,
      price(employee: { id: string; levelId: string | null }, date: string, minutes: number) {
        const levelId = levelAt(employee, date);
        const rate = levelId ? ratesByLevel.get(levelId)?.find((p) => within(date, p)) : undefined;
        return {
          level: levelId ? (codeOf.get(levelId) ?? '-') : '-',
          rate: rate ?? null,
          cost: rate ? priceOf(minutes, rate) : null,
          missing: !levelId ? ('NO_LEVEL' as const) : !rate ? ('NO_RATE' as const) : null,
        };
      },
      unitsUsed() {
        return [...new Set(rates.map((r) => (r.unit === RateUnit.HOUR ? 'HOUR' : `DAY/${r.minutesPerDay}`)))];
      },
    };
  }

  async customerCost(user: AuthUser, from: string, to: string, basis: LevelBasis) {
    const entries = await this.loadEntries(user, from, to);
    const p = await this.pricer([...new Set(entries.map((e) => e.employee.id))], basis);
    type Bucket = { minutes: number; cost: number; unpricedMinutes: number };
    const bucket = (): Bucket => ({ minutes: 0, cost: 0, unpricedMinutes: 0 });
    const add = (b: Bucket, minutes: number, cost: number | null) => {
      b.minutes += minutes;
      if (cost === null) b.unpricedMinutes += minutes;
      else b.cost += cost;
    };
    const customers = new Map<string, Bucket & { id: string; code: string; name: string; accountOwner: string | null; byLevel: Record<string, Bucket> }>();
    const internal = new Map<WorkCategoryType, Bucket>();
    const missing = { NO_LEVEL: 0, NO_RATE: 0 };
    const total = bucket();

    for (const e of entries) {
      const priced = p.price(e.employee, toIsoDate(e.workDate), e.durationMinutes);
      if (priced.missing) missing[priced.missing] += e.durationMinutes;
      add(total, e.durationMinutes, priced.cost);
      const type = e.engagement.workCategory.type;
      if (type !== WorkCategoryType.CLIENT_WORK) {
        const b = internal.get(type) ?? bucket();
        add(b, e.durationMinutes, priced.cost);
        internal.set(type, b);
        continue;
      }
      const c = e.engagement.customer;
      let row = customers.get(c.id);
      if (!row) {
        row = { id: c.id, code: c.code, name: c.name, accountOwner: c.accountOwner?.fullName ?? null, ...bucket(), byLevel: {} };
        customers.set(c.id, row);
      }
      add(row, e.durationMinutes, priced.cost);
      row.byLevel[priced.level] ??= bucket();
      add(row.byLevel[priced.level], e.durationMinutes, priced.cost);
    }

    const fix = <T extends Bucket>(b: T) => ({ ...b, cost: round2(b.cost) });
    return {
      from,
      to,
      basis,
      levels: p.levels.map(({ code, name }) => ({ code, name })),
      units: p.unitsUsed(),
      customers: [...customers.values()]
        .map((c) => ({ ...fix(c), byLevel: Object.fromEntries(Object.entries(c.byLevel).map(([k, v]) => [k, fix(v)])) }))
        .sort((a, b) => b.cost - a.cost || a.code.localeCompare(b.code)),
      internal: [WorkCategoryType.INTERNAL, WorkCategoryType.MEETING, WorkCategoryType.LEAVE]
        .filter((t) => internal.has(t))
        .map((t) => ({ type: t, ...fix(internal.get(t)!) })),
      total: fix(total),
      missing,
    };
  }

  /** Entry-level detail for one customer (legacy j_query.php?com_ — now behind login, scope and cost.read). */
  async customerCostDetail(user: AuthUser, customerId: string, from: string, to: string, basis: LevelBasis) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, code: true, name: true, accountOwner: { select: { fullName: true } } } });
    if (!customer) throw notFound('ลูกค้า');
    const entries = await this.loadEntries(user, from, to, { engagement: { customerId } });
    const p = await this.pricer([...new Set(entries.map((e) => e.employee.id))], basis);
    return {
      customer: { ...customer, accountOwner: customer.accountOwner?.fullName ?? null },
      basis,
      rows: entries.map((e) => {
        const date = toIsoDate(e.workDate);
        const priced = p.price(e.employee, date, e.durationMinutes);
        return {
          id: e.id,
          date,
          activity: e.engagement.workCategory.name,
          categoryType: e.engagement.workCategory.type,
          employee: `${e.employee.fullName}${e.employee.nickname ? ` (${e.employee.nickname})` : ''}`,
          level: priced.level,
          minutes: e.durationMinutes,
          rate: priced.rate ? { amount: priced.rate.amount, unit: priced.rate.unit, minutesPerDay: priced.rate.minutesPerDay } : null,
          cost: priced.cost === null ? null : round2(priced.cost),
        };
      }),
    };
  }
}
