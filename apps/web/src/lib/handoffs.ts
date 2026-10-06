/** รับ–ส่งเอกสาร (ex-DELIPAS): tickets live on the monday board; the API lists them and writes the outcome back. */

import { ApiError } from './api';

export interface HandoffDocument {
  title: string;
  detail: string;
  quantity: string;
}

export interface HandoffItem {
  id: string;
  name: string;
  customer: string;
  date: string;
  period: string;
  type: string;
  location: string;
  contact: string;
  note: string;
  status: string;
  statusValue: string;
  updatedAt: string;
  group: string | null;
  files: { name: string }[];
  documents: HandoffDocument[];
}

export interface HandoffGroup {
  key: string;
  title: string;
  items: HandoffItem[];
}

export interface HandoffList {
  board: string;
  today: string;
  groups: HandoffGroup[];
}

export interface HandoffDetail {
  item: HandoffItem;
  /** Signed token bound to the status/update time that was seen; sent back with the save. */
  context: string;
  expiresAt?: string;
}

export interface SaveBody {
  itemId: string;
  outcome: Outcome;
  name: string;
  signature: string;
  requestId: string;
  context: string;
}

export interface SaveResult {
  ok: true;
  replayed: boolean;
  status: string;
}

export const OUTCOMES = [
  { value: '1', label: 'ได้รับครบถ้วน / ส่งมอบแล้ว', full: 'ได้รับเอกสารครบถ้วน/ส่งมอบเอกสารแล้ว' },
  { value: '0', label: 'รับเอกสารไม่ครบถ้วน', full: 'รับเอกสารไม่ครบถ้วน' },
  { value: '2', label: 'ไม่ได้รับ / ไม่ได้ส่งมอบ', full: 'ไม่ได้รับเอกสาร/ไม่ได้ส่งมอบเอกสาร' },
] as const;
export type Outcome = (typeof OUTCOMES)[number]['value'];

export function statusTone(status: string): 'done' | 'issue' | 'open' {
  if (status.includes('ครบถ้วน/')) return 'done';
  if (status.includes('ไม่')) return 'issue';
  return 'open';
}

/**
 * The share-link page has no session: plain fetch, no CSRF, and no redirect to /login on errors.
 */
export async function publicApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/public${path}`, {
    method: init.method ?? 'GET',
    headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    credentials: 'omit',
    cache: 'no-store',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = res.status === 429 ? 'มีการเรียกใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' : (data.message ?? 'เกิดข้อผิดพลาด');
    throw new ApiError(res.status, data.code ?? 'ERROR', message, data);
  }
  return data as T;
}
