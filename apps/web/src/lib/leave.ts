/** HR leave (docs/09) — types mirror the API. 1 day = 540 minutes. */

export type LeaveUnit = 'DAYS' | 'HOURS';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export const DAY_MINUTES = 540;

export interface LeaveTypeRef {
  id: string;
  key: string;
  name: string;
  color: string | null;
  paid: boolean;
  allowHours?: boolean;
  certificateFromDays?: number | null;
}

export interface LeaveType extends LeaveTypeRef {
  annualMinutes: number | null;
  annualDays: number | null;
  minTenureMonths: number;
  allowHours: boolean;
  certificateFromDays: number | null;
  appliesTo: string[];
  source: string | null;
  sortOrder: number;
  isActive: boolean;
  workCategory: { name: string; legacyId: number | null };
}

export interface Balance {
  type: LeaveTypeRef & { allowHours: boolean; certificateFromDays: number | null };
  year: number;
  entitledMinutes: number | null;
  overridden: boolean;
  note: string | null;
  usedMinutes: number;
  pendingMinutes: number;
  remainingMinutes: number | null;
}

export interface LeaveRequest {
  id: string;
  employee: { id: string; fullName: string; nickname: string | null; team: string | null };
  type: LeaveTypeRef;
  unit: LeaveUnit;
  startDate: string;
  endDate: string;
  minutes: number;
  days: { date: string; minutes: number }[];
  reason: string;
  status: LeaveStatus;
  overQuota: boolean;
  needsCertificate: boolean;
  documentReceived: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  filedBy: string | null;
  createdAt: string;
  version: number;
  canCancel?: boolean;
  noTeamApprover?: boolean;
  inMyTeams?: boolean;
  balance?: Balance | null;
}

export interface MyLeave {
  year: number;
  today: string;
  dayMinutes: number;
  approver: string | null;
  balances: Balance[];
  requests: LeaveRequest[];
}

export interface LeavePreview {
  ok: boolean;
  code?: string;
  message?: string;
  days?: { date: string; minutes: number }[];
  minutes?: number;
  overQuota?: boolean;
  needsCertificate?: boolean;
  balances?: { year: number; remainingMinutes: number | null; afterMinutes: number | null }[];
}

export interface CalendarEntry {
  id: string;
  employee: { id: string; name: string };
  status: LeaveStatus;
  type: { name: string; color: string | null } | null;
  unit: LeaveUnit;
  days: { date: string; minutes: number }[];
}

export interface Person {
  id: string;
  fullName: string;
  nickname: string | null;
  orgUnit: { name: string } | null;
}

export const personLabel = (p: { fullName: string; nickname: string | null }) => (p.nickname ? `${p.nickname} · ${p.fullName}` : p.fullName);

/** 1620 → "3 วัน", 600 → "1 วัน 1 ชม.", 180 → "3 ชม.", 0 → "0 วัน". */
export function daysText(minutes: number | null | undefined): string {
  if (minutes == null) return 'ไม่จำกัด';
  const sign = minutes < 0 ? '-' : '';
  const m = Math.abs(minutes);
  const d = Math.floor(m / DAY_MINUTES);
  const h = Math.round(((m % DAY_MINUTES) / 60) * 10) / 10;
  if (!d && !h) return '0 วัน';
  return sign + [d ? `${d} วัน` : '', h ? `${h} ชม.` : ''].filter(Boolean).join(' ');
}

export const STATUS_LABEL: Record<LeaveStatus, string> = { PENDING: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก' };
export const STATUS_TONE: Record<LeaveStatus, 'amber' | 'brand' | 'rose' | 'gray'> = { PENDING: 'amber', APPROVED: 'brand', REJECTED: 'rose', CANCELLED: 'gray' };

/** Leave type colour tokens (Tailwind classes kept literal so they are not purged). */
export const TYPE_COLOR: Record<string, { dot: string; soft: string; bar: string; text: string }> = {
  sky: { dot: 'bg-sky-500', soft: 'bg-sky-50 ring-sky-200', bar: 'bg-sky-500', text: 'text-sky-700' },
  amber: { dot: 'bg-amber-500', soft: 'bg-amber-50 ring-amber-200', bar: 'bg-amber-500', text: 'text-amber-700' },
  rose: { dot: 'bg-rose-500', soft: 'bg-rose-50 ring-rose-200', bar: 'bg-rose-500', text: 'text-rose-700' },
  emerald: { dot: 'bg-emerald-500', soft: 'bg-emerald-50 ring-emerald-200', bar: 'bg-emerald-500', text: 'text-emerald-700' },
  violet: { dot: 'bg-violet-500', soft: 'bg-violet-50 ring-violet-200', bar: 'bg-violet-500', text: 'text-violet-700' },
  indigo: { dot: 'bg-indigo-500', soft: 'bg-indigo-50 ring-indigo-200', bar: 'bg-indigo-500', text: 'text-indigo-700' },
  gray: { dot: 'bg-gray-400', soft: 'bg-gray-50 ring-gray-200', bar: 'bg-gray-400', text: 'text-gray-700' },
};
export const typeColor = (c: string | null | undefined) => TYPE_COLOR[c ?? 'gray'] ?? TYPE_COLOR.gray;

/** Date range label: "5 – 7 พ.ย." / "5 พ.ย." */
export function rangeLabel(start: string, end: string, thaiDateShort: (iso: string) => string) {
  return start === end ? thaiDateShort(start) : `${thaiDateShort(start)} – ${thaiDateShort(end)}`;
}
