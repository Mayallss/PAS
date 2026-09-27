import type { DayStatus, WorkCategoryType } from './types';

/** Minutes → decimal hours, e.g. 90 → "1.5", 45 → "0.75", 540 → "9". Empty string for 0. */
export function hours(minutes: number): string {
  if (!minutes) return '';
  return String(Math.round((minutes / 60) * 100) / 100);
}

/**
 * Parses what people naturally type into a time cell. Returns minutes, null for "clear", or NaN if unreadable.
 *   "2" "2.5" "2,5" "2h" "2 ชม"  → hours
 *   "2:30"                      → 2 h 30 min
 *   "90m" "90 น" "90 นาที"       → minutes
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(',', '.');
  if (s === '' || s === '-' || s === '0') return null;
  let m = s.match(/^(\d{1,2}):([0-5]?\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|น\.?|นาที)$/);
  if (m) return Math.round(Number(m[1]));
  m = s.match(/^(\d*(?:\.\d+)?)\s*(h|hr|ชม\.?|ชั่วโมง)?$/);
  if (m && m[1] !== '' && m[1] !== '.') return Math.round(Number(m[1]) * 60);
  return Number.NaN;
}

export const THAI_WEEKDAY_SHORT = ['', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
export const THAI_WEEKDAY_LONG = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];

/** "2026-09" → "กันยายน 2569" */
export function thaiMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

/** "2026-09-27" → "27 กันยายน 2569" */
export function thaiDate(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}

/** "2026-09-27" → "27 ก.ย." */
export function thaiDateShort(iso: string): string {
  const [, m, d] = parts(iso);
  return `${d} ${THAI_MONTHS_SHORT[m - 1]}`;
}

/** Week label: "22 – 28 ก.ย. 2569" or "29 ก.ย. – 5 ต.ค. 2569". */
export function weekLabel(start: string, end: string): string {
  const [, sm, sd] = parts(start);
  const [ey, em, ed] = parts(end);
  return sm === em ? `${sd} – ${ed} ${THAI_MONTHS_SHORT[em - 1]} ${ey + 543}` : `${sd} ${THAI_MONTHS_SHORT[sm - 1]} – ${ed} ${THAI_MONTHS_SHORT[em - 1]} ${ey + 543}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing the date. */
export function mondayOf(iso: string): string {
  const [y, m, d] = parts(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  return addDays(iso, 1 - dow);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function todayBangkok(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

export function currentMonth(): string {
  return todayBangkok().slice(0, 7);
}

/** Visual language for day status — shared by grid, calendar and reports. */
export const STATUS_STYLE: Record<DayStatus, { text: string; bg: string; bar: string; label: string }> = {
  OFF: { text: 'text-gray-400', bg: '', bar: 'bg-gray-200', label: 'วันหยุด' },
  EMPTY: { text: 'text-gray-400', bg: '', bar: 'bg-gray-200', label: 'ยังไม่บันทึก' },
  UNDER: { text: 'text-amber-700', bg: 'bg-amber-50', bar: 'bg-amber-400', label: 'ยังไม่ครบ' },
  COMPLETE: { text: 'text-emerald-700', bg: 'bg-emerald-50', bar: 'bg-emerald-500', label: 'ครบ' },
  OVER: { text: 'text-rose-700', bg: 'bg-rose-50', bar: 'bg-rose-500', label: 'เกินเป้า' },
};

export const CATEGORY_DOT: Record<WorkCategoryType, string> = {
  CLIENT_WORK: 'bg-emerald-500',
  INTERNAL: 'bg-sky-500',
  MEETING: 'bg-violet-500',
  LEAVE: 'bg-amber-500',
};

export const CATEGORY_LABEL: Record<WorkCategoryType, string> = {
  CLIENT_WORK: 'งานลูกค้า',
  INTERNAL: 'งานภายใน',
  MEETING: 'ประชุม',
  LEAVE: 'ลา',
};

/** Legacy status map kept for report tables. */
export const STATUS_CLASS: Record<DayStatus, string> = Object.fromEntries(
  Object.entries(STATUS_STYLE).map(([k, v]) => [k, `${v.bg} ${v.text}`]),
) as Record<DayStatus, string>;
