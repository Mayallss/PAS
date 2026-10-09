import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import { normalizeTaxId } from './revenue.parser';
import type { TrcloudReadCommand } from './trcloud.client';

/**
 * TRCLOUD answer → our shapes. THE ONLY PLACE that knows TRCLOUD field names.
 *
 * Confirmed against the live API (2026-10-09, probe + counts-only stats):
 *  - contact/search → result[]: contact_id (internal), title = document_number (the "#code" users see), name,
 *    organization (company name when set), tax_id, address, contact_type (supplier | normal …), obsolete
 *  - revenue = report/b3 ("BL - ใบแจ้งหนี้ (ตามเอกสาร/สินค้า)", user decision 2026-10-09) → result[], ONE ROW PER
 *    ITEM LINE: document (BL…), issue_date, contact_id, code (the contact's "#code"), organization, tax_id,
 *    before_vat / vat / after_vat (per line; before_vat = price × quantity), status (Paid, Forced Success, Cancel),
 *    doc_type "Credit[BL]". Takes date-from / date-to (YYYY-MM-DD, required, honoured). Lines are summed per document.
 *  - contact/search does not page (page/limit ignored).
 * Anything a sync needs and cannot find stops the sync (TRCLOUD_MAPPING) instead of importing zeros.
 */

export interface Endpoint {
  group: string;
  command: TrcloudReadCommand;
}

export const ENDPOINTS = {
  contacts: { group: 'contact', command: 'search' } as Endpoint,
  /** ใบแจ้งหนี้: the invoice report, item lines */
  invoices: { group: 'report', command: 'b3' } as Endpoint,
  /** ใบลดหนี้ (subtracted from revenue) — null until its endpoint is confirmed. */
  creditNotes: null as Endpoint | null,
};

/** report/b3 range (inclusive). It does not page. */
export function invoiceQuery(from: string, to: string, _page: number): Record<string, unknown> {
  return { 'date-from': from, 'date-to': to };
}

const FIELDS = {
  contactId: ['contact_id'],
  contactCode: ['document_number', 'title'],
  /** A company's name is in `organization`; a person-type contact only has `name`. */
  contactName: ['organization', 'name'],
  taxId: ['tax_id'],
  address: ['address'],
  /** On a report line: the contact's "#code" directly. */
  lineContactCode: ['code'],
  docNo: ['document', 'invoice_number'],
  docDate: ['issue_date', 'tax_date'],
  status: ['status'],
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
  /** TRCLOUD's internal id — invoices point to it. */
  id: string;
  /** The "#code" people see; what we store on the customer. */
  code: string;
  name: string;
  taxId: string | null;
  address: string | null;
  /** supplier contacts never carry revenue and are left out of the customer sync. */
  supplier: boolean;
  obsolete: boolean;
}

export interface TrDocument {
  docNo: string;
  date: string;
  contactId: string;
  /** The contact's "#code" when the line carries it (report/b3 does). */
  contactCode: string | null;
  contactName: string;
  taxId: string | null;
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

/**
 * A contact, or null when it has no "#code" (it cannot be linked or shown by code — it is counted as skipped).
 * Missing id or name still stops the sync: that would mean the field names changed.
 */
export function toContact(raw: Raw): TrContact | null {
  const id = text(pick(raw, 'contactId'));
  const name = text(pick(raw, 'contactName'));
  if (!id) throw missing('รหัสภายในของคู่ค้า', FIELDS.contactId, raw);
  const code = text(pick(raw, 'contactCode'));
  if (!code) return null;
  if (!name) throw missing('ชื่อคู่ค้า', FIELDS.contactName, raw);
  return {
    id,
    code,
    name,
    taxId: normalizeTaxId(text(pick(raw, 'taxId'))),
    address: text(pick(raw, 'address')) || null,
    supplier: /supplier/i.test(text(raw.contact_type)),
    obsolete: text(raw.obsolete) === '1',
  };
}

/**
 * Before-VAT amount: a report line's before_vat (else after_vat − vat); a document's grand_total − tax (else total).
 * Empty fields are "missing", never 0.
 */
function beforeVat(raw: Raw): number | null {
  const line = money(raw.before_vat);
  if (line !== null) return line;
  const diff = (a: unknown, b: unknown) => (money(a) !== null && money(b) !== null ? Math.round((money(a)! - money(b)!) * 100) / 100 : null);
  return diff(raw.after_vat, raw.vat) ?? diff(raw.grand_total, raw.tax) ?? money(raw.total);
}

export function toDocument(raw: Raw, sign: 1 | -1 = 1): TrDocument {
  const docNo = text(pick(raw, 'docNo'));
  const date = isoDate(pick(raw, 'docDate'));
  const contactId = text(pick(raw, 'contactId'));
  const amount = beforeVat(raw);
  if (!docNo) throw missing('เลขที่เอกสาร', FIELDS.docNo, raw);
  if (!date) throw missing('วันที่เอกสาร', FIELDS.docDate, raw);
  if (!contactId) throw missing('คู่ค้าในเอกสาร', FIELDS.contactId, raw);
  if (amount === null) throw missing('ยอดก่อน VAT', ['before_vat', 'after_vat', 'vat'], raw);
  return {
    docNo,
    date,
    contactId,
    contactCode: text(pick(raw, 'lineContactCode')) || null,
    contactName: text(pick(raw, 'contactName')),
    taxId: normalizeTaxId(text(pick(raw, 'taxId'))),
    amount: sign * Math.abs(amount),
    cancelled: /cancel|void|ยกเลิก/i.test(text(pick(raw, 'status'))),
  };
}
