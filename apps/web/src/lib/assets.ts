/** IT asset register — API shapes and the Thai labels shared by list, detail and onboarding screens. */

export type AssetStatus = 'ACTIVE' | 'IN_REPAIR' | 'BROKEN' | 'RETIRED' | 'DISPOSED' | 'LOST';
/** What people see: ACTIVE splits into in use / free / reserved for a new hire. */
export type AssetState = 'IN_USE' | 'AVAILABLE' | 'RESERVED' | 'IN_REPAIR' | 'BROKEN' | 'RETIRED' | 'DISPOSED' | 'LOST';
export type RequestType = 'REPAIR' | 'REPLACEMENT' | 'UPGRADE' | 'SOFTWARE' | 'DEVICE' | 'OTHER';
export type RequestStatus = 'SUBMITTED' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED' | 'CANCELLED';
export type Urgency = 'NORMAL' | 'URGENT';
export type AssignmentKind = 'PRIMARY' | 'LOAN' | 'SHARED';
export type AssetEventType =
  | 'REGISTERED'
  | 'ASSIGNED'
  | 'RETURNED'
  | 'STATUS_CHANGED'
  | 'ISSUE'
  | 'REPAIR'
  | 'UPGRADE'
  | 'SOFTWARE'
  | 'INSPECTION'
  | 'SPEC_CORRECTED'
  | 'NOTE'
  | 'DISPOSED';
export type AttachmentKind = 'RECEIPT' | 'QUOTATION' | 'PHOTO' | 'DELIVERY_NOTE' | 'WARRANTY' | 'REPORT' | 'OTHER';
export type Specs = Record<string, string>;

export interface Category {
  id: string;
  key: string;
  name: string;
  codePrefix: string;
  specFields: { key: string; label: string }[];
}

export interface AssetOptions {
  categories: Category[];
  locations: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  employees: { id: string; fullName: string; nickname: string | null; employeeCode: string | null }[];
}

export interface Holder {
  kind: AssignmentKind;
  name: string;
  employeeId: string | null;
  locationId: string | null;
  dueDate: string | null;
  startDate?: string | null;
  overdue?: boolean;
}

export interface AssetRow {
  id: string;
  code: string;
  category: { id: string; name: string; key: string };
  status: AssetStatus;
  state: AssetState;
  openRequests: number;
  brand: string | null;
  model: string | null;
  specs: Specs;
  purchaseDate: string | null;
  ageYears: number | null;
  pastUsefulLife: boolean;
  holder: Holder | null;
  lastEvent: { type: AssetEventType; title: string; occurredOn: string } | null;
}

export interface AssetSummary {
  total: number;
  byState: Record<AssetState, number>;
  pastUsefulLife: number;
  overdueLoans: number;
  openRequests: number;
}

export interface AssetEvent {
  id: string;
  type: AssetEventType;
  occurredOn: string;
  completedOn: string | null;
  title: string;
  detail: string | null;
  specDiff: Record<string, [string | null, string | null]> | null;
  fromStatus: AssetStatus | null;
  toStatus: AssetStatus | null;
  cost: string | null;
  vendor: string | null;
  underWarranty: boolean | null;
  employee: string | null;
  recordedBy: string;
  recordedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  openRepair: boolean;
  requestNumber: number | null;
}

export interface AttachmentRow {
  id: string;
  assetEventId: string | null;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface AssetDetail {
  id: string;
  code: string;
  category: Category;
  status: AssetStatus;
  state: AssetState;
  requests: { id: string; number: number; type: RequestType; status: RequestStatus; urgency: Urgency; title: string; requester: string; createdAt: string }[];
  brand: string | null;
  model: string | null;
  serialNo: string | null;
  hostname: string | null;
  faCode: string | null;
  specs: Specs;
  purchaseDate: string | null;
  cost: string | null;
  usefulLifeYears: number;
  usefulLifeEnds: string | null;
  warrantyUntil: string | null;
  vendor: { id: string; name: string } | null;
  notes: string | null;
  version: number;
  ageYears: number | null;
  holder: Holder | null;
  assignments: {
    id: string;
    kind: AssignmentKind;
    holder: string;
    employeeId: string | null;
    locationId: string | null;
    startDate: string;
    endDate: string | null;
    dueDate: string | null;
    approximate: boolean;
    note: string | null;
    createdBy: string;
  }[];
  events: AssetEvent[];
  attachments: AttachmentRow[];
}

export interface MyDevice {
  code: string;
  category: string;
  specFields: { key: string; label: string }[];
  brand: string | null;
  model: string | null;
  serialNo: string | null;
  specs: Specs;
  status: AssetStatus;
  state: AssetState;
  purchaseDate: string | null;
  warrantyUntil: string | null;
  kind: AssignmentKind;
  startDate: string;
  dueDate: string | null;
  overdue: boolean;
  history: {
    id: string;
    type: AssetEventType;
    occurredOn: string;
    completedOn: string | null;
    title: string;
    detail: string | null;
    specDiff: Record<string, [string | null, string | null]> | null;
    underWarranty: boolean | null;
  }[];
}

export interface ItRequest {
  id: string;
  number: number;
  type: RequestType;
  status: RequestStatus;
  urgency: Urgency;
  title: string;
  detail: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  requester: { id: string; fullName: string; nickname: string | null; employeeCode: string | null };
  handler: string | null;
  asset: { code: string; model: string; status: AssetStatus; state: AssetState } | null;
  repairOpen: boolean;
  updates: { id: string; fromStatus: RequestStatus | null; toStatus: RequestStatus; note: string | null; by: string; createdAt: string }[];
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }[];
}

type Tone = 'gray' | 'brand' | 'amber' | 'rose' | 'sky';

export const STATE_META: Record<AssetState, { label: string; tone: Tone; hint: string }> = {
  IN_USE: { label: 'ใช้งานอยู่', tone: 'brand', hint: 'มีผู้ถือ ใช้งานปกติ' },
  AVAILABLE: { label: 'ว่าง', tone: 'sky', hint: 'เครื่องสำรอง พร้อมมอบให้' },
  RESERVED: { label: 'รอส่งมอบ', tone: 'sky', hint: 'จองให้พนักงานใหม่ที่ยังไม่เริ่มงาน' },
  IN_REPAIR: { label: 'ส่งซ่อม', tone: 'amber', hint: 'อยู่ระหว่างซ่อม' },
  BROKEN: { label: 'ไม่พร้อมใช้งาน', tone: 'rose', hint: 'เสีย / รอตัดสินใจ' },
  RETIRED: { label: 'เลิกใช้งาน', tone: 'gray', hint: 'เก่า ไม่เหมาะกับงานปัจจุบัน' },
  DISPOSED: { label: 'จำหน่ายแล้ว', tone: 'gray', hint: 'ขาย / ทิ้งแล้ว' },
  LOST: { label: 'สูญหาย', tone: 'rose', hint: 'หาไม่พบ' },
};
export const ASSET_STATES = Object.keys(STATE_META) as AssetState[];

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  REPAIR: 'แจ้งซ่อม',
  REPLACEMENT: 'ขอเปลี่ยนเครื่อง',
  UPGRADE: 'ขออัปเกรด',
  SOFTWARE: 'ติดตั้ง / แก้ไขโปรแกรม',
  DEVICE: 'ขออุปกรณ์เพิ่ม',
  OTHER: 'อื่น ๆ',
};
export const REQUEST_TYPE_HINT: Record<RequestType, string> = {
  REPAIR: 'เครื่องเสีย เปิดไม่ติด จอ/คีย์บอร์ด/แบตเตอรี่มีปัญหา',
  REPLACEMENT: 'เครื่องช้า/เก่าเกินใช้งาน ขอเครื่องใหม่',
  UPGRADE: 'ขอเพิ่ม RAM, เปลี่ยน SSD',
  SOFTWARE: 'ลงโปรแกรม, Windows/Office มีปัญหา, ESET',
  DEVICE: 'ขอจอเสริม เมาส์ คีย์บอร์ด หูฟัง',
  OTHER: 'เรื่องอื่นที่ต้องการให้ IT ช่วย',
};
export const REQUEST_STATUS_META: Record<RequestStatus, { label: string; tone: Tone }> = {
  SUBMITTED: { label: 'รอ IT รับเรื่อง', tone: 'amber' },
  IN_PROGRESS: { label: 'กำลังดำเนินการ', tone: 'sky' },
  RESOLVED: { label: 'เสร็จแล้ว', tone: 'brand' },
  REJECTED: { label: 'ไม่อนุมัติ', tone: 'rose' },
  CANCELLED: { label: 'ยกเลิก', tone: 'gray' },
};
export const requestNo = (n: number) => `REQ-${String(n).padStart(4, '0')}`;

export const STATUS_META: Record<AssetStatus, { label: string; tone: 'gray' | 'brand' | 'amber' | 'rose' | 'sky' }> = {
  ACTIVE: { label: 'ใช้งานได้', tone: 'brand' },
  IN_REPAIR: { label: 'ส่งซ่อม', tone: 'amber' },
  BROKEN: { label: 'ไม่พร้อมใช้งาน', tone: 'rose' },
  RETIRED: { label: 'เลิกใช้งาน', tone: 'gray' },
  DISPOSED: { label: 'จำหน่ายแล้ว', tone: 'gray' },
  LOST: { label: 'สูญหาย', tone: 'rose' },
};

export const KIND_LABEL: Record<AssignmentKind, string> = { PRIMARY: 'ใช้ประจำ', LOAN: 'ยืมชั่วคราว', SHARED: 'ใช้ร่วม' };

export const EVENT_LABEL: Record<AssetEventType, string> = {
  REGISTERED: 'ลงทะเบียน',
  ASSIGNED: 'มอบ / ย้าย',
  RETURNED: 'รับคืน',
  STATUS_CHANGED: 'เปลี่ยนสถานะ',
  ISSUE: 'แจ้งปัญหา',
  REPAIR: 'ซ่อม',
  UPGRADE: 'อัปเกรด / เปลี่ยนชิ้นส่วน',
  SOFTWARE: 'ซอฟต์แวร์',
  INSPECTION: 'ตรวจตามรอบ',
  SPEC_CORRECTED: 'แก้สเปกที่บันทึกผิด',
  NOTE: 'บันทึก',
  DISPOSED: 'จำหน่าย',
};

/** Events a person can record from the device page (the rest are written by the system). */
export const MANUAL_EVENTS: AssetEventType[] = ['REPAIR', 'UPGRADE', 'ISSUE', 'SOFTWARE', 'INSPECTION', 'NOTE', 'SPEC_CORRECTED'];

export const ATTACHMENT_LABEL: Record<AttachmentKind, string> = {
  RECEIPT: 'ใบเสร็จ / ใบกำกับภาษี',
  QUOTATION: 'ใบเสนอราคา',
  PHOTO: 'รูปถ่าย',
  DELIVERY_NOTE: 'ใบส่งของ',
  WARRANTY: 'ใบรับประกัน',
  REPORT: 'รายงานการซ่อม / ตรวจ',
  OTHER: 'อื่น ๆ',
};

export function money(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '–';
  return Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const personLabel = (e: { fullName: string; nickname: string | null; employeeCode?: string | null }) =>
  `${e.fullName}${e.nickname ? ` (${e.nickname})` : ''}${e.employeeCode ? ` · ${e.employeeCode}` : ''}`;
