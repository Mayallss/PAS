/** Calendar-date helpers. Work dates are plain dates (no time zone); they are stored as UTC midnight. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isIsoMonth(value: string): boolean {
  return ISO_MONTH.test(value);
}

export function toDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = toDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Today's calendar date in the business time zone (Asia/Bangkok by default). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function monthRange(month: string): { from: string; to: string; days: string[] } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  return { from: days[0], to: days[days.length - 1], days };
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(isoDate: string): number {
  const d = toDate(isoDate).getUTCDay();
  return d === 0 ? 7 : d;
}

export function isWeekend(isoDate: string): boolean {
  return isoWeekday(isoDate) >= 6;
}

export function weekRange(isoDate: string): { monday: string; friday: string; days: string[] } {
  const monday = addDays(isoDate, 1 - isoWeekday(isoDate));
  const days = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
  return { monday, friday: days[4], days };
}
