import type { EmploymentType } from '@prisma/client';
import { addDays } from '../../common/dates';

/** 1 day of leave = 540 minutes (9 h, decision 2026-09-29) — used to show balances in days. */
export const LEAVE_DAY_MINUTES = 540;
/** Longest single request (calendar days). Maternity leave is 98 days (LPA s.41). [ข้อเสนอ] */
export const MAX_RANGE_DAYS = 120;
/** How far ahead leave can be filed. [ข้อเสนอ] */
export const MAX_AHEAD_DAYS = 365;

export interface TypeRules {
  annualMinutes: number | null;
  minTenureMonths: number;
  appliesTo: EmploymentType[];
}

export function appliesTo(type: Pick<TypeRules, 'appliesTo'>, employmentType: EmploymentType) {
  return type.appliesTo.length === 0 || type.appliesTo.includes(employmentType);
}

/** ISO date `months` after `iso` (clamped to the month's last day, like "1 year after 29 Feb"). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Minutes a person is entitled to for one type in one calendar year.
 * HR's override wins; otherwise the type default, or 0 before the tenure requirement is met within that year
 * (annual leave: after 1 year of service — the year it is reached gets the full default [ข้อเสนอ]).
 * null = no quota.
 */
export function entitlementFor(
  type: TypeRules,
  year: number,
  employee: { startDate: string | null; employmentType: EmploymentType },
  override: number | null,
): number | null {
  if (override != null) return override;
  if (!appliesTo(type, employee.employmentType)) return 0;
  if (type.annualMinutes == null) return null;
  if (type.minTenureMonths > 0 && employee.startDate && addMonths(employee.startDate, type.minTenureMonths) > `${year}-12-31`) return 0;
  return type.annualMinutes;
}

export interface DayPlan {
  date: string;
  minutes: number;
}

/**
 * The days a request charges. DAYS: every date with required work time (schedule minus holidays) at that
 * day's required minutes — weekends and full holidays cost nothing, a half-day holiday costs the other half.
 * HOURS: one date, the given minutes, at most that day's required minutes.
 */
export function planDays(
  input: { unit: 'DAYS' | 'HOURS'; startDate: string; endDate: string; minutes?: number | null },
  requiredByDate: Map<string, number>,
  incrementMinutes: number,
): { days: DayPlan[] } | { error: { code: string; message: string } } {
  if (input.endDate < input.startDate) return { error: { code: 'VALIDATION_FAILED', message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม' } };
  if (input.unit === 'HOURS') {
    if (input.startDate !== input.endDate) return { error: { code: 'VALIDATION_FAILED', message: 'ลาเป็นชั่วโมงได้ครั้งละ 1 วัน' } };
    const required = requiredByDate.get(input.startDate) ?? 0;
    const minutes = input.minutes ?? 0;
    if (required <= 0) return { error: { code: 'NOT_A_WORKING_DAY', message: 'วันที่เลือกเป็นวันหยุด ไม่ต้องลา' } };
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes % incrementMinutes !== 0) {
      return { error: { code: 'DURATION_INCREMENT', message: `จำนวนชั่วโมงต้องเป็นทวีคูณของ ${incrementMinutes} นาที` } };
    }
    if (minutes > required) return { error: { code: 'DURATION_TOO_LONG', message: `วันนั้นต้องทำงาน ${required / 60} ชม. ลาได้ไม่เกินนี้ (ถ้าลาทั้งวัน ให้เลือก "ลาเป็นวัน")` } };
    return { days: [{ date: input.startDate, minutes }] };
  }
  const days: DayPlan[] = [];
  for (let d = input.startDate, guard = 0; d <= input.endDate && guard <= MAX_RANGE_DAYS; d = addDays(d, 1), guard++) {
    const required = requiredByDate.get(d) ?? 0;
    if (required > 0) days.push({ date: d, minutes: required });
  }
  if (!days.length) return { error: { code: 'NOT_A_WORKING_DAY', message: 'ช่วงที่เลือกไม่มีวันทำงาน ไม่ต้องลา' } };
  return { days };
}

/** Every calendar date in [from, to]. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Overlap with leave already filed (pending or approved). Two requests of the same type on one day are refused
 * (the timesheet holds one row per activity per day — cancel and refile with the total); different types may
 * share a day as long as together they stay within that day's required minutes.
 */
export function overlapProblem(
  days: DayPlan[],
  typeId: string,
  existing: { date: string; minutes: number; typeId: string }[],
  requiredByDate: Map<string, number>,
): { code: string; message: string; date: string } | null {
  for (const d of days) {
    const same = existing.filter((e) => e.date === d.date);
    if (same.some((e) => e.typeId === typeId)) {
      return { code: 'LEAVE_SAME_DAY', message: `มีใบลาประเภทนี้ในวันที่ ${d.date} แล้ว — ยกเลิกใบเดิมแล้วยื่นใหม่รวมเวลา`, date: d.date };
    }
    const already = same.reduce((a, e) => a + e.minutes, 0);
    if (already + d.minutes > (requiredByDate.get(d.date) ?? 0)) {
      return { code: 'LEAVE_OVERLAP', message: `วันที่ ${d.date} ลาไว้แล้ว ${already / 60} ชม. รวมแล้วเกินเวลาทำงานของวันนั้น`, date: d.date };
    }
  }
  return null;
}

/** Minutes per calendar year (a request over New Year counts in both years). */
export function minutesByYear(days: DayPlan[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const d of days) {
    const y = Number(d.date.slice(0, 4));
    out.set(y, (out.get(y) ?? 0) + d.minutes);
  }
  return out;
}
