import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import { normalizeTaxId } from './revenue.parser';

/**
 * TRCLOUD answer → our shapes. THE ONLY PLACE that knows TRCLOUD field names.
 *
 * PROVISIONAL: the API manual documents the protocol, not each endpoint's fields; those live on each endpoint page
 * inside TRCLOUD. Each field below accepts the likely names; confirm them with
 *   node --env-file=../../.env scripts/trcloud-probe.mjs contact search
 * and narrow the lists. Anything a sync needs and cannot find stops the sync (MAPPING) instead of importing zeros.
 */

export const ENDPOINTS = {
  contacts: { group: 'contact', command: 'search' as const },
  /** ใบแจ้งหนี้ — group name to confirm on its endpoint page in TRCLOUD. */
  invoices: { group: 'invoice', command: 'search' as const },
  /** ใบลดหนี้ (subtracted from revenue) — null until its endpoint is confirmed. */
  creditNotes: null as { group: string; command: 'search' } | null,
};

/** Search filters for a date range — parameter names to confirm on the endpoint page. */
export function invoiceQuery(from: string, to: string, page: number): Record<string, unknown> {
  return { date_from: from, date_to: to, page };
}

const FIELDS = {
  contactCode: ['contact_code', 'code', 'customer_code', 'contact_no'],
  contactName: ['company_name', 'contact_name', 'name', 'name_th', 'organization'],
  taxId: ['tax_id', 'taxid', 'tax_no', 'tax_number'],
  address: ['address', 'contact_address', 'address1', 'bill_address'],
  docNo: ['doc_no', 'document_no', 'doc_number', 'invoice_no', 'number'],
  docDate: ['doc_date', 'document_date', 'invoice_date', 'issue_date', 'date'],
  /** Before VAT (decision: revenue excludes VAT). */
  amount: ['total_before_vat', 'amount_before_vat', 'before_vat', 'total_exclude_vat', 'sub_total', 'subtotal', 'net_amount'],
  status: ['status', 'doc_status', 'document_status'],
} as const;
type Field = keyof typeof FIELDS;

type Raw = Record<string, unknown>;

function pick(raw: Raw, field: Field): unknown {
  for (const k of FIELDS[field]) {
    const v = raw[k] ?? raw[k.toUpperCase()];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}
const text = (v: unknown) => (v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Records of a search answer, wherever TRCLOUD puts them (result / body / data; array or keyed object). */
export function records(answer: Raw): Raw[] {
  for (const key of ['result', 'body', 'data', 'list', 'items']) {
    const v = answer[key];
    if (Array.isArray(v)) return v as Raw[];
    if (v && typeof v === 'object') {
      const inner = Object.values(v as Raw);
      if (inner.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return inner as Raw[];
    }
  }
  return [];
}

/** More pages to fetch? (paging field names to confirm) */
export function hasMore(answer: Raw, page: number): boolean {
  const total = Number(answer.total_page ?? answer.total_pages ?? answer.page_count ?? (answer.paging as Raw | undefined)?.total_page ?? 0);
  return total > page;
}

/** "2026-09-15", "15/09/2026", "15/09/2569" (Buddhist year) → "2026-09-15"; anything else → null. */
export function isoDate(v: unknown): string | null {
  const s = text(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${Number(m[1]) > 2400 ? Number(m[1]) - 543 : m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const y = Number(m[3]) > 2400 ? Number(m[3]) - 543 : Number(m[3]);
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/** Empty is "missing", never 0 (Number("") is 0 — that would import zero revenue silently). */
const money = (v: unknown) => {
  const s = text(v).replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

export interface TrContact {
  code: string;
  name: string;
  taxId: string | null;
  address: string | null;
}

export interface TrDocument {
  docNo: string;
  date: string;
  contactCode: string;
  contactName: string;
  /** Before VAT; negative for a credit note. */
  amount: number;
  cancelled: boolean;
}

const missing = (what: string, keys: readonly string[], sample: Raw) =>
  new DomainError(
    'TRCLOUD_MAPPING',
    `อ่าน${what}จาก TRCLOUD ไม่ได้ — ไม่พบฟิลด์ (${keys.join(', ')}) ในข้อมูลที่ได้ (มีฟิลด์: ${Object.keys(sample).slice(0, 25).join(', ')}) ต้องปรับ trcloud.mapping.ts`,
    HttpStatus.BAD_GATEWAY,
  );

export function toContact(raw: Raw): TrContact {
  const code = text(pick(raw, 'contactCode'));
  const name = text(pick(raw, 'contactName'));
  if (!code) throw missing('รหัสคู่ค้า', FIELDS.contactCode, raw);
  if (!name) throw missing('ชื่อคู่ค้า', FIELDS.contactName, raw);
  return { code, name, taxId: normalizeTaxId(text(pick(raw, 'taxId'))), address: text(pick(raw, 'address')) || null };
}

export function toDocument(raw: Raw, sign: 1 | -1 = 1): TrDocument {
  const docNo = text(pick(raw, 'docNo'));
  const date = isoDate(pick(raw, 'docDate'));
  const contactCode = text(pick(raw, 'contactCode'));
  const amount = money(pick(raw, 'amount'));
  if (!docNo) throw missing('เลขที่เอกสาร', FIELDS.docNo, raw);
  if (!date) throw missing('วันที่เอกสาร', FIELDS.docDate, raw);
  if (!contactCode) throw missing('รหัสคู่ค้าในเอกสาร', FIELDS.contactCode, raw);
  if (amount === null) throw missing('ยอดก่อน VAT', FIELDS.amount, raw);
  return {
    docNo,
    date,
    contactCode,
    contactName: text(pick(raw, 'contactName')),
    amount: sign * Math.abs(amount),
    cancelled: /cancel|void|ยกเลิก/i.test(text(pick(raw, 'status'))),
  };
}
