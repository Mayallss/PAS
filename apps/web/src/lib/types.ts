export type Permission =
  | 'time.own.write'
  | 'todo.assign'
  | 'handoff.use'
  | 'report.team.read'
  | 'report.all.read'
  | 'report.export'
  | 'catalog.write'
  | 'calendar.write'
  | 'employee.admin'
  | 'role.admin'
  | 'announcement.write'
  | 'meeting.write'
  | 'asset.read'
  | 'asset.write'
  | 'onboarding.manage'
  | 'leave.manage'
  | 'room.manage'
  | 'cost.read'
  | 'cost.write'
  | 'revenue.write'
  | 'audit.read';

/** Role keys are data now (custom roles allowed); these are the built-in ones. */
export type Role = 'EMPLOYEE' | 'MANAGER' | 'PARTNER' | 'ADMIN' | 'IT' | (string & {});

export interface Me {
  user: { id: string; fullName: string; email: string | null; roles: Role[]; permissions: Permission[]; orgUnitId: string | null };
  csrfToken: string;
  sessionExpiresAt: string;
}

export type DayStatus = 'OFF' | 'EMPTY' | 'UNDER' | 'COMPLETE' | 'OVER';
export type WorkCategoryType = 'CLIENT_WORK' | 'INTERNAL' | 'MEETING' | 'LEAVE';

export interface Policy {
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
  /** Posted by an approved leave request — read-only in the timesheet. */
  leaveRequestId?: string | null;
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
  workCategory: { id: string; name: string; type: WorkCategoryType; group: string | null };
  period?: { start: string; end: string | null } | null;
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
  /** From the employee's work schedule, before holidays. */
  scheduledMinutes: number;
  /** What must be recorded: schedule minus company holiday minutes. */
  requiredMinutes: number;
  totalMinutes: number;
  status: DayStatus;
}

export interface WeekView {
  weekStart: string;
  weekEnd: string;
  today: string;
  employee: { id: string; fullName: string };
  scheduleName: string | null;
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
  code?: string | null;
  budgetMinutes?: number | null;
  workCategory: { id: string; name: string; type: string; group?: string | null };
}

// ---------------------------------------------------------------------------
// Employee portal
// ---------------------------------------------------------------------------

export type AppKind = 'INTERNAL' | 'EXTERNAL' | 'PLANNED';

export interface AppLink {
  id: string;
  key: string;
  name: string;
  description: string | null;
  url: string | null;
  icon: string;
  kind: AppKind;
  category: string;
  /** Admin page — sidebar "ผู้ดูแลระบบ" section, not the employee launcher. */
  isAdmin: boolean;
  /** Position in the user's pinned list (null = not pinned). */
  favorite: number | null;
}

export type AttentionItem =
  | { kind: 'TIME_MISSING'; id: string; date: string; missingMinutes: number; href: string }
  | { kind: 'ACK_REQUIRED'; id: string; announcementId: string; title: string; publishedAt: string; href: string }
  | { kind: 'TEAM_INCOMPLETE'; id: string; weekStart: string; incomplete: number; total: number; href: string }
  | { kind: 'IT_REQUESTS'; id: string; count: number; href: string }
  | { kind: 'LEAVE_APPROVALS'; id: string; count: number; href: string }
  | { kind: 'MEETING_CERTIFY'; id: string; meetingId: string; title: string; reason: 'NEW' | 'REVISED' | 'REPLIED'; version: number; href: string }
  | { kind: 'MEETING_OBJECTIONS'; id: string; meetingId: string; title: string; count: number; href: string };

export interface ProgressDay {
  date: string;
  weekday: number;
  requiredMinutes: number;
  totalMinutes: number;
  status: DayStatus;
  locked: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  requiresAck: boolean;
  pinned: boolean;
  publishedAt: string;
  author: string;
  ackedAt: string | null;
  ackCount?: number;
  audience?: number;
}

export interface HomeData {
  today: string;
  profile: { fullName: string; nickname: string | null; email: string | null; orgUnit: string | null; level: string | null; roles: string[] };
  week: { weekStart: string; days: ProgressDay[]; recordedMinutes: number; requiredMinutes: number };
  monthToDate: { recordedMinutes: number; requiredMinutes: number; dueDays: number; completeDays: number };
  attention: AttentionItem[];
  announcements: (Omit<Announcement, 'body'> & { excerpt: string })[];
  apps: AppLink[];
}

// ---------------------------------------------------------------------------
// Meeting minutes
// ---------------------------------------------------------------------------

export type PersonStatus = 'PENDING' | 'OUTDATED' | 'ACCEPTED' | 'OBJECTION' | 'OBJECTION_REPLIED';

export interface MeetingListItem {
  id: string;
  title: string;
  meetingDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  version: number;
  certifyFromVersion: number;
  author: string;
  isAuthor: boolean;
  myStatus: PersonStatus | null;
  updatedAt: string;
  counts?: { accepted: number; objections: number; pending: number; audience: number };
}

export interface CertificationView {
  employeeId: string;
  employee: string;
  version: number;
  status: 'ACCEPTED' | 'OBJECTION';
  quote: string | null;
  note: string | null;
  reply: string | null;
  repliedAt: string | null;
  repliedBy: string | null;
  at: string;
}

export interface MeetingDetail extends Omit<MeetingListItem, 'counts'> {
  bodyHtml: string;
  revisions: { version: number; title: string; changeNote: string | null; requiresRecertification: boolean; author: string; createdAt: string }[];
  myHistory: CertificationView[];
  diff: { from: number; to: number; html: string; added: number; removed: number } | null;
  roster?: { employeeId: string; fullName: string; orgUnit: string | null; status: PersonStatus; version: number | null; at: string | null }[];
  objections?: CertificationView[];
}

// ---------------------------------------------------------------------------
// Work plan (To-do) — estimate; actual comes from the timesheet
// ---------------------------------------------------------------------------

export type TodoStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TodoPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface TodoItem {
  id: string;
  /** TASK = a customer's Activity (the estimate); CUSTOM = free-text personal note, never counted. */
  kind: 'TASK' | 'CUSTOM';
  task: Task | null;
  title: string | null;
  workDate: string;
  /** Required for TASK; optional for CUSTOM. */
  plannedMinutes: number | null;
  /** Minutes logged in the timesheet for the same task and day (0 for CUSTOM). */
  actualMinutes: number;
  /** All (non-cancelled) planned minutes for the same task and day — the fair comparison for actualMinutes. */
  taskDayPlannedMinutes: number | null;
  note: string | null;
  priority: TodoPriority;
  status: TodoStatus;
  late: boolean;
  assignedBy: { id: string; fullName: string; nickname: string | null } | null;
  version: number;
}

export interface PlanDay {
  date: string;
  weekday: number;
  weekend: boolean;
  holiday: { minutes: number; description: string } | null;
  locked: boolean;
  requiredMinutes: number;
  plannedMinutes: number;
  actualMinutes: number;
}

export interface PlanWeek {
  weekStart: string;
  weekEnd: string;
  today: string;
  employee: { id: string; fullName: string; nickname: string | null };
  own: boolean;
  canEdit: boolean;
  policy: { incrementMinutes: number; maxEntryMinutes: number };
  days: PlanDay[];
  items: TodoItem[];
  /** Unfinished items from earlier weeks (within the last 31 days). */
  overdue: number;
  recentTasks: Task[];
  /** Present only for cost.read. */
  cost: { planned: number; actual: number; unpricedMinutes: number } | null;
}

export interface TeamPlan {
  weekStart: string;
  today: string;
  dates: string[];
  canAssign: boolean;
  people: {
    employee: { id: string; fullName: string; nickname: string | null; team: string | null };
    lateItems: number;
    days: { date: string; requiredMinutes: number; plannedMinutes: number; actualMinutes: number }[];
  }[];
}
