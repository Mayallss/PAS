import type { TimePolicy } from '@prisma/client';
import { addDays } from '../../common/dates';

export type PolicyValues = Pick<TimePolicy, 'incrementMinutes' | 'maxEntryMinutes' | 'maxDailyMinutes' | 'backdateDays' | 'futureDays'>;

export const LEGACY_POLICY: PolicyValues = {
  incrementMinutes: 30,
  maxEntryMinutes: 540,
  maxDailyMinutes: null,
  backdateDays: null,
  futureDays: 31,
};

export interface EntryCheck {
  policy: PolicyValues;
  today: string; //                 business-time-zone date
  workDate: string;
  durationMinutes: number;
  /** Minutes already recorded that day by the employee, excluding the entry being edited. */
  otherMinutesSameDay: number;
  periodLocked: boolean;
  engagementActive: boolean;
}

export interface Violation {
  code: string;
  message: string;
}

const hours = (m: number) => `${m / 60} ชม.`;

/** Pure business validation for creating/updating a time entry. Returns every violation found. */
export function checkEntry(c: EntryCheck): Violation[] {
  const v: Violation[] = [];
  const { policy: p } = c;

  if (!Number.isInteger(c.durationMinutes) || c.durationMinutes <= 0) {
    v.push({ code: 'DURATION_INVALID', message: 'ระยะเวลาต้องมากกว่า 0' });
  } else {
    if (c.durationMinutes % p.incrementMinutes !== 0) {
      v.push({ code: 'DURATION_INCREMENT', message: `ระยะเวลาต้องเป็นทวีคูณของ ${p.incrementMinutes} นาที` });
    }
    if (c.durationMinutes > p.maxEntryMinutes) {
      v.push({ code: 'DURATION_TOO_LONG', message: `รายการเดียวต้องไม่เกิน ${hours(p.maxEntryMinutes)}` });
    }
    if (p.maxDailyMinutes != null && c.otherMinutesSameDay + c.durationMinutes > p.maxDailyMinutes) {
      v.push({ code: 'DAILY_LIMIT', message: `รวมทั้งวันต้องไม่เกิน ${hours(p.maxDailyMinutes)}` });
    }
  }
  if (c.periodLocked) v.push({ code: 'PERIOD_LOCKED', message: 'งวดนี้ถูกปิดแล้ว ไม่สามารถแก้ไขได้' });
  if (!c.engagementActive) v.push({ code: 'ENGAGEMENT_INACTIVE', message: 'งานนี้ถูกปิดสำหรับลูกค้ารายนี้แล้ว' });
  if (p.backdateDays != null && c.workDate < addDays(c.today, -p.backdateDays)) {
    v.push({ code: 'BACKDATE_LIMIT', message: `บันทึกย้อนหลังได้ไม่เกิน ${p.backdateDays} วัน` });
  }
  if (c.workDate > addDays(c.today, p.futureDays)) {
    v.push({ code: 'FUTURE_LIMIT', message: `บันทึกล่วงหน้าได้ไม่เกิน ${p.futureDays} วัน` });
  }
  return v;
}

/** Deleting only needs the period to be open (and backdating rules). */
export function checkDelete(c: Pick<EntryCheck, 'policy' | 'today' | 'workDate' | 'periodLocked'>): Violation[] {
  const v: Violation[] = [];
  if (c.periodLocked) v.push({ code: 'PERIOD_LOCKED', message: 'งวดนี้ถูกปิดแล้ว ไม่สามารถแก้ไขได้' });
  if (c.policy.backdateDays != null && c.workDate < addDays(c.today, -c.policy.backdateDays)) {
    v.push({ code: 'BACKDATE_LIMIT', message: `แก้ไขย้อนหลังได้ไม่เกิน ${c.policy.backdateDays} วัน` });
  }
  return v;
}

export type DayStatus = 'OFF' | 'EMPTY' | 'UNDER' | 'COMPLETE' | 'OVER';

/** Legacy colour rule: < target = under, = target = complete, > target = over. */
export function dayStatus(totalMinutes: number, targetMinutes: number): DayStatus {
  if (totalMinutes <= 0) return 'EMPTY';
  if (totalMinutes < targetMinutes) return 'UNDER';
  return totalMinutes === targetMinutes ? 'COMPLETE' : 'OVER';
}

/**
 * Status against the minutes actually required that day (weekend = 0, holidays reduce it).
 * Non-working days are OFF unless someone worked, which counts as complete rather than "over".
 */
export function dayStatusFor(totalMinutes: number, requiredMinutes: number): DayStatus {
  if (requiredMinutes <= 0) return totalMinutes > 0 ? 'COMPLETE' : 'OFF';
  return dayStatus(totalMinutes, requiredMinutes);
}

/**
 * Minutes an employee must record on a date: what their work schedule expects that weekday,
 * minus company holiday minutes (a full-day holiday removes the whole day, a half-day holiday part of it).
 */
export function requiredFrom(scheduleMinutes: number, holidayMinutes: number): number {
  return Math.max(0, scheduleMinutes - Math.min(scheduleMinutes, holidayMinutes));
}
