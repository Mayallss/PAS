/** Onboarding / employee profile — API shapes and labels. */

export type EmploymentType = 'EMPLOYEE' | 'INTERN' | 'DIRECTOR' | 'CONTRACTOR';
export type TaskStatus = 'TODO' | 'DONE' | 'SKIPPED' | 'NOT_APPLICABLE';
export type AccountStatus = 'PENDING' | 'ACTIVE' | 'DISABLED';

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  EMPLOYEE: 'พนักงาน',
  INTERN: 'นักศึกษาฝึกงาน',
  DIRECTOR: 'กรรมการ',
  CONTRACTOR: 'สัญญาจ้าง / ชั่วคราว',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'ยังไม่ทำ',
  DONE: 'เสร็จ',
  SKIPPED: 'ข้าม',
  NOT_APPLICABLE: 'ไม่เกี่ยวข้อง',
};

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = { PENDING: 'รอเปิด', ACTIVE: 'ใช้งาน', DISABLED: 'ปิดแล้ว' };

export interface OnboardingOptions {
  departments: { id: string; name: string }[];
  systems: { id: string; key: string; name: string; identifierLabel: string }[];
  templates: {
    id: string;
    key: string;
    title: string;
    description: string | null;
    dueOffsetDays: number;
    appliesTo: EmploymentType[];
    requiresAsset: boolean;
    system: { name: string } | null;
  }[];
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  key: string | null;
  system: { id: string; name: string; identifierLabel: string } | null;
  requiresAsset: boolean;
  dueDate: string;
  status: TaskStatus;
  note: string | null;
  account: { identifier: string; status: AccountStatus } | null;
  assetCode: string | null;
  doneBy: string | null;
  doneAt: string | null;
}

export interface QueueTask extends Task {
  overdue: boolean;
  case: { id: string; kind: 'ONBOARDING' | 'OFFBOARDING' };
  employee: { id: string; fullName: string; nickname: string | null; employeeCode: string | null; startDate: string | null; employmentType: EmploymentType };
}

export interface EmployeeProfile {
  id: string;
  employeeCode: string | null;
  fullName: string;
  fullNameEn: string | null;
  nickname: string | null;
  email: string | null;
  personalEmail?: string | null;
  employmentType: EmploymentType;
  status: 'ACTIVE' | 'INACTIVE';
  startDate: string | null;
  endDate: string | null;
  institution: string | null;
  department: { id: string; name: string } | null;
  orgUnit: { id: string; name: string } | null;
  level: { id: string; code: string; name: string } | null;
  roleAssignments: { roleId: string; orgUnitId: string | null; role: { key: string; name: string }; orgUnit: { name: string } | null }[];
  levelHistory?: { code: string; name: string; effectiveFrom: string; effectiveTo: string | null }[];
  accounts: {
    id: string;
    identifier: string;
    status: AccountStatus;
    activatedOn: string | null;
    disabledOn: string | null;
    note: string | null;
    system: { id: string; key: string; name: string; identifierLabel: string };
  }[];
  devices: { assignmentId: string; code: string; category: string; model: string | null; kind: 'PRIMARY' | 'LOAN' | 'SHARED'; startDate: string; endDate: string | null; dueDate: string | null }[];
  cases: { id: string; kind: 'ONBOARDING' | 'OFFBOARDING'; openedOn: string; closedOn: string | null; tasks: Task[] }[];
}
