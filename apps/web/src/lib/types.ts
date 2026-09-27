export type Permission =
  | 'time.own.write'
  | 'report.team.read'
  | 'report.all.read'
  | 'report.export'
  | 'catalog.write'
  | 'calendar.write'
  | 'employee.admin'
  | 'audit.read';

export type Role = 'EMPLOYEE' | 'MANAGER' | 'PARTNER' | 'ADMIN' | 'IT';

export interface Me {
  user: { id: string; fullName: string; email: string | null; roles: Role[]; permissions: Permission[]; orgUnitId: string | null };
  csrfToken: string;
  sessionExpiresAt: string;
}

export type DayStatus = 'OFF' | 'EMPTY' | 'UNDER' | 'COMPLETE' | 'OVER';
export type WorkCategoryType = 'CLIENT_WORK' | 'INTERNAL' | 'MEETING' | 'LEAVE';

export interface Policy {
  dailyTargetMinutes: number;
  incrementMinutes: number;
  maxEntryMinutes: number;
  maxDailyMinutes: number | null;
  backdateDays: number | null;
  futureDays: number;
}

export interface Entry {
  id: string;
  engagementId: string;
  workDate: string;
  durationMinutes: number;
  description: string | null;
  status: string;
  version: number;
  updatedAt?: string;
  /** Client-only: last server-confirmed values, used to roll back a failed optimistic save. */
  saved?: { durationMinutes: number; description: string | null } | null;
  /** Client-only: optimistic delete awaiting server confirmation. */
  deleted?: boolean;
  /** Client-only: save in flight. */
  pending?: boolean;
}

export interface Task {
  engagementId: string;
  active: boolean;
  customer: { id: string; code: string; name: string };
  workCategory: { id: string; name: string; type: WorkCategoryType };
}

export interface WeekRow extends Task {
  cells: Record<string, Entry>;
  totalMinutes: number;
  carried: boolean;
}

export interface DayInfo {
  date: string;
  weekday: number;
  weekend: boolean;
  holiday: { minutes: number; description: string } | null;
  locked: boolean;
  requiredMinutes: number;
  totalMinutes: number;
  status: DayStatus;
}

export interface WeekView {
  weekStart: string;
  weekEnd: string;
  today: string;
  employee: { id: string; fullName: string };
  editable: boolean;
  policy: Policy;
  days: DayInfo[];
  rows: WeekRow[];
  recentEngagements: Task[];
  totals: { recordedMinutes: number; requiredMinutes: number };
}

export interface MonthSummary {
  month: string;
  today: string;
  locked: boolean;
  days: DayInfo[];
  totals: { recordedMinutes: number; requiredMinutes: number; dueDays: number; completeDueDays: number };
}

export interface CustomerOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  taxId?: string | null;
  address?: string | null;
  accountOwner?: { id: string; fullName: string } | null;
}

export interface EngagementOption {
  id: string;
  isActive: boolean;
  workCategory: { id: string; name: string; type: string };
}
