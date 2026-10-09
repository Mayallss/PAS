/**
 * Interactive cost / hours report — data side. The API sends one compact row per time entry
 * (GET /reports/analytics); everything here is pure: filter, group, bucket by time.
 */

import { addDays, CATEGORY_LABEL, mondayOf, thaiDateShort, todayBangkok } from '@/lib/format';
import type { WorkCategoryType } from '@/lib/types';

export type Basis = 'CURRENT' | 'AT_DATE';
/** [date, customer index, activity index, employee index, level code, minutes, cost | null] */
export type Row = [string, number, number, number, string, number, number | null];

export interface Analytics {
  from: string;
  to: string;
  basis: Basis;
  /** False without cost.read: every cost is null and the page shows hours only. */
  priced: boolean;
  units: string[];
  levels: { code: string; name: string }[];
  customers: { id: string; code: string; name: string; owner: string | null }[];
  activities: { id: string; name: string; type: WorkCategoryType }[];
  employees: { id: string; name: string; team: string | null }[];
  rows: Row[];
  /** Imported revenue for the range (pro-rata by days). Null unless the reader sees every team's cost. */
  revenue: RevenueForRange | null;
  revenueHidden: 'TEAM_SCOPE' | 'NO_COST_PERMISSION' | null;
}

export interface RevenueForRange {
  customers: { id: string; code: string; name: string; owner: string | null; amount: number }[];
  /** Revenue rows not matched to a customer yet — counted in the total, not per customer. */
  unmatched: number;
  batches: number;
}

// ---------------------------------------------------------------------------
// Profit (revenue − cost of time) per customer
// ---------------------------------------------------------------------------

/** Revenue belongs to a customer, not to a person or an activity: profit is defined only for these filters. */
export const PROFIT_DIMS: Dim[] = ['customer', 'owner'];
export const profitApplies = (filters: Filters) => DIM_KEYS.every((k) => filters[k] === undefined || PROFIT_DIMS.includes(k));

export interface ProfitRow {
  id: string;
  code: string;
  name: string;
  revenue: number;
  cost: number;
  profit: number;
  /** profit / revenue; null when there is no revenue to divide by. */
  margin: number | null;
  unpricedMinutes: number;
  hasRevenue: boolean;
}

export function profitByCustomer(d: Analytics, rows: Row[], filters: Filters): { list: ProfitRow[]; revenue: number; cost: number; unmatched: number } {
  const map = new Map<string, ProfitRow>();
  const row = (id: string, code: string, name: string) =>
    map.get(id) ?? map.set(id, { id, code, name, revenue: 0, cost: 0, profit: 0, margin: null, unpricedMinutes: 0, hasRevenue: false }).get(id)!;
  for (const r of rows) {
    const c = d.customers[r[1]];
    const p = row(c.id, c.code, c.name);
    if (r[6] === null) p.unpricedMinutes += r[5];
    else p.cost += r[6];
  }
  const keep = (c: { id: string; owner: string | null }) =>
    (filters.customer === undefined || filters.customer === c.id) && (filters.owner === undefined || (c.owner ?? '—') === filters.owner);
  for (const c of d.revenue?.customers ?? []) {
    if (!keep(c)) continue;
    const p = row(c.id, c.code, c.name);
    p.revenue += c.amount;
    p.hasRevenue = true;
  }
  const list = [...map.values()].map((p) => ({ ...p, profit: p.revenue - p.cost, margin: p.revenue ? (p.revenue - p.cost) / p.revenue : null }));
  const unmatched = filters.customer === undefined && filters.owner === undefined ? (d.revenue?.unmatched ?? 0) : 0;
  return { list, revenue: list.reduce((a, p) => a + p.revenue, 0) + unmatched, cost: list.reduce((a, p) => a + p.cost, 0), unmatched };
}

export type Metric = 'cost' | 'hours';

// ---------------------------------------------------------------------------
// Dimensions: every way the page can group or filter. Keys are stable across date ranges (ids / codes), so a
// filter survives changing the period and can live in the URL.
// ---------------------------------------------------------------------------

export const DIMENSIONS = {
  customer: 'ลูกค้า',
  activity: 'Activity',
  employee: 'พนักงาน',
  team: 'ทีม',
  level: 'ระดับ',
  owner: 'ผู้ดูแลลูกค้า',
  type: 'ประเภทงาน',
} as const;
export type Dim = keyof typeof DIMENSIONS;
export const DIM_KEYS = Object.keys(DIMENSIONS) as Dim[];
export type Filters = Partial<Record<Dim, string>>;

const NONE = '—';

export function keyOf(d: Analytics, r: Row, dim: Dim): string {
  switch (dim) {
    case 'customer':
      return d.customers[r[1]].id;
    case 'activity':
      return d.activities[r[2]].id;
    case 'employee':
      return d.employees[r[3]].id;
    case 'team':
      return d.employees[r[3]].team ?? NONE;
    case 'level':
      return r[4];
    case 'owner':
      return d.customers[r[1]].owner ?? NONE;
    case 'type':
      return d.activities[r[2]].type;
  }
}

/** What a key reads as. `sub` is the small grey line under it (customer code, team, …). */
export function labelOf(d: Analytics | undefined, dim: Dim, key: string): { title: string; sub?: string } {
  if (key === NONE) return { title: dim === 'team' ? 'ไม่มีทีม' : dim === 'owner' ? 'ไม่ระบุผู้ดูแล' : 'ไม่ระบุ' };
  switch (dim) {
    case 'customer': {
      const c = d?.customers.find((x) => x.id === key);
      return c ? { title: c.name, sub: c.code } : { title: 'ลูกค้าที่เลือก' };
    }
    case 'activity': {
      const a = d?.activities.find((x) => x.id === key);
      return a ? { title: a.name, sub: CATEGORY_LABEL[a.type] } : { title: 'Activity ที่เลือก' };
    }
    case 'employee': {
      const e = d?.employees.find((x) => x.id === key);
      return e ? { title: e.name, sub: e.team ?? undefined } : { title: 'พนักงานที่เลือก' };
    }
    case 'level':
      return key === '-' ? { title: 'ไม่มีระดับ' } : { title: key, sub: d?.levels.find((l) => l.code === key)?.name };
    case 'type':
      return { title: CATEGORY_LABEL[key as WorkCategoryType] ?? key };
    default:
      return { title: key };
  }
}

/**
 * Rows that pass the filters. Non-client work (internal, meetings, leave) is left out unless asked for — the
 * original customer report showed it apart — but an explicit "ประเภทงาน" filter always wins.
 */
export function applyFilters(d: Analytics, filters: Filters, opts: { includeInternal: boolean; except?: Dim }): Row[] {
  const active = DIM_KEYS.filter((k) => k !== opts.except && filters[k] !== undefined);
  const typeChosen = filters.type !== undefined && opts.except !== 'type';
  return d.rows.filter((r) => {
    if (!opts.includeInternal && !typeChosen && d.activities[r[2]].type !== 'CLIENT_WORK') return false;
    return active.every((k) => keyOf(d, r, k) === filters[k]);
  });
}

export interface Totals {
  minutes: number;
  cost: number;
  /** Minutes with no level or no rate: counted in hours, never priced as 0. */
  unpricedMinutes: number;
  entries: number;
}

export function totals(rows: Row[]): Totals {
  const t: Totals = { minutes: 0, cost: 0, unpricedMinutes: 0, entries: rows.length };
  for (const r of rows) add(t, r);
  return t;
}

function add(t: Totals, r: Row) {
  t.minutes += r[5];
  if (r[6] === null) t.unpricedMinutes += r[5];
  else t.cost += r[6];
}

export const value = (t: Totals, metric: Metric) => (metric === 'cost' ? t.cost : t.minutes / 60);

export interface Group extends Totals {
  key: string;
}

/** Totals per key of one dimension, largest first by the chosen metric. */
export function groupBy(d: Analytics, rows: Row[], dim: Dim, metric: Metric): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const k = keyOf(d, r, dim);
    let g = map.get(k);
    if (!g) map.set(k, (g = { key: k, minutes: 0, cost: 0, unpricedMinutes: 0, entries: 0 }));
    add(g, r);
    g.entries++;
  }
  return [...map.values()].sort((a, b) => value(b, metric) - value(a, metric) || b.minutes - a.minutes);
}

// ---------------------------------------------------------------------------
// Time buckets for the trend chart
// ---------------------------------------------------------------------------

export type Grain = 'day' | 'week' | 'month';
export const GRAIN_LABEL: Record<Grain, string> = { day: 'รายวัน', week: 'รายสัปดาห์', month: 'รายเดือน' };

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

/** Enough columns to see a shape, few enough to read on a phone. */
export function autoGrain(from: string, to: string): Grain {
  const n = daysBetween(from, to);
  return n <= 35 ? 'day' : n <= 120 ? 'week' : 'month';
}

export interface Bucket extends Totals {
  /** First and last day of the bucket, clipped to the selected range (clicking a column zooms to these). */
  from: string;
  to: string;
  label: string;
}

const lastOfMonth = (iso: string) => addDays(`${monthAfter(iso)}-01`, -1);
function monthAfter(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
const THAI_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** Every bucket in the range, empty ones included, so gaps in the work show as gaps. */
export function buckets(rows: Row[], from: string, to: string, grain: Grain): Bucket[] {
  const out: Bucket[] = [];
  let start = from;
  while (start <= to) {
    const end = grain === 'day' ? start : grain === 'week' ? addDays(mondayOf(start), 6) : lastOfMonth(start);
    const clipped = end > to ? to : end;
    const [y, m] = start.split('-').map(Number);
    const label = grain === 'month' ? `${THAI_MONTH_SHORT[m - 1]} ${String((y + 543) % 100).padStart(2, '0')}` : thaiDateShort(start);
    out.push({ from: start, to: clipped, label, minutes: 0, cost: 0, unpricedMinutes: 0, entries: 0 });
    start = addDays(clipped, 1);
  }
  let i = 0;
  for (const r of [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    while (i < out.length - 1 && r[0] > out[i].to) i++;
    add(out[i], r);
    out[i].entries++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const PRESETS = [
  ['month', 'เดือนนี้'],
  ['last-month', 'เดือนที่แล้ว'],
  ['quarter', 'ไตรมาสนี้'],
  ['90d', '90 วันล่าสุด'],
  ['year', 'ปีนี้'],
] as const;
export type Preset = (typeof PRESETS)[number][0];

export function presetRange(p: Preset, today = todayBangkok()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const mm = (n: number) => String(n).padStart(2, '0');
  switch (p) {
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last-month': {
      const first = m === 1 ? `${y - 1}-12-01` : `${y}-${mm(m - 1)}-01`;
      return { from: first, to: lastOfMonth(first) };
    }
    case 'quarter':
      return { from: `${y}-${mm(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'year':
      return { from: `${y}-01-01`, to: today };
  }
}

/** The same number of days just before the range — what the KPI deltas compare against. */
export function previousRange(from: string, to: string) {
  const n = daysBetween(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const bahtRound = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });
export const hoursText = (minutes: number) => (Math.round((minutes / 60) * 10) / 10).toLocaleString('th-TH');

/** Axis / bar-end figures: 950 · 12.5K · 1.2M. */
export function compact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${trim(n / 1e6)}M`;
  if (a >= 1e3) return `${trim(n / 1e3)}K`;
  return trim(n);
}
const trim = (n: number) => String(Math.round(n * 10) / 10);

export const metricText = (t: Totals, metric: Metric) => (metric === 'cost' ? `฿${bahtRound(t.cost)}` : `${hoursText(t.minutes)} ชม.`);

/** Clean axis ticks: 0, step, 2·step … covering max (step from 1 / 2 / 2.5 / 5 × 10ⁿ). */
export function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
