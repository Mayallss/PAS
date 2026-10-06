import type { AssetStatus } from './assets';

export type LicenseType = 'SUBSCRIPTION' | 'PERPETUAL' | 'OEM' | 'FREE' | 'TRIAL' | 'OTHER';
export type LicenseMetric = 'PER_DEVICE' | 'PER_USER' | 'SITE' | 'CONCURRENT';
export type LicenseState = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'NO_EXPIRY';

export interface SoftwareRow {
  id: string;
  name: string;
  publisher: string | null;
  category: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
  licenseCount: number;
  activeSeats: number;
}

export interface LicenseRow {
  id: string;
  software: { id: string; name: string; category: string | null };
  name: string;
  edition: string | null;
  type: LicenseType;
  metric: LicenseMetric;
  seats: number | null;
  used: number;
  startDate: string | null;
  endDate: string | null;
  state: LicenseState;
  daysLeft: number | null;
  autoRenew: boolean;
  cost: number | null;
  vendor: { id: string; name: string } | null;
  reference: string | null;
  keyHint: string | null;
  attributes: Record<string, string>;
  notes: string | null;
  renewedFromId: string | null;
  renewedBy: { id: string; name: string } | null;
  archivedAt: string | null;
  version: number;
}

export interface LicenseList {
  today: string;
  expiringDays: number;
  licenses: LicenseRow[];
  overview: { expiring: number; expired: number; full: number; withoutAntivirus: { code: string; category: string }[] };
}

export interface SeatRow {
  id: string;
  asset: { code: string; status: AssetStatus; category: string; hostname: string | null; model: string | null } | null;
  employee: { id: string; fullName: string; nickname: string | null } | null;
  startDate: string;
  endDate: string | null;
  installedOn: string | null;
  seatLabel: string | null;
  note: string | null;
  createdBy: string;
}

export interface LicenseDetail extends LicenseRow {
  renewedFrom: { id: string; name: string } | null;
  seatsList: SeatRow[];
}

export interface AssetSeat {
  id: string;
  licenseId: string;
  license: string;
  software: { id: string; name: string; category: string | null };
  type: LicenseType;
  startDate: string;
  endDate: string | null;
  installedOn: string | null;
  licenseEnd: string | null;
  state: LicenseState;
  daysLeft: number | null;
  seatLabel: string | null;
  note: string | null;
}

export const TYPE_LABEL: Record<LicenseType, string> = {
  SUBSCRIPTION: 'รายปี / สมาชิก',
  PERPETUAL: 'ซื้อขาด',
  OEM: 'มากับเครื่อง (OEM)',
  FREE: 'ฟรี',
  TRIAL: 'ทดลองใช้',
  OTHER: 'อื่น ๆ',
};

export const METRIC_LABEL: Record<LicenseMetric, string> = {
  PER_DEVICE: 'ต่อเครื่อง',
  PER_USER: 'ต่อผู้ใช้',
  SITE: 'ทั้งองค์กร',
  CONCURRENT: 'ใช้พร้อมกัน',
};

export const STATE_META: Record<LicenseState, { label: string; tone: 'brand' | 'amber' | 'rose' | 'gray' | 'sky' }> = {
  ACTIVE: { label: 'ใช้งานได้', tone: 'brand' },
  EXPIRING: { label: 'ใกล้หมดอายุ', tone: 'amber' },
  EXPIRED: { label: 'หมดอายุ', tone: 'rose' },
  NO_EXPIRY: { label: 'ไม่มีวันหมดอายุ', tone: 'sky' },
};

/** Suggestions only — category is free text. */
export const SOFTWARE_CATEGORIES = ['แอนตี้ไวรัส', 'ระบบปฏิบัติการ', 'Office', 'โปรแกรมบัญชี', 'PDF / เอกสาร', 'รีโมท / สื่อสาร', 'อื่น ๆ'];

export function stateText(l: { state: LicenseState; daysLeft: number | null }) {
  if (l.state === 'NO_EXPIRY') return STATE_META.NO_EXPIRY.label;
  if (l.state === 'EXPIRED') return `หมดอายุแล้ว ${Math.abs(l.daysLeft ?? 0)} วัน`;
  return `เหลือ ${l.daysLeft} วัน`;
}
