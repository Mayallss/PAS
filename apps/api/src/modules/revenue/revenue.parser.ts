import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { DomainError } from '../../common/errors';

/**
 * Revenue file → rows, and rows → customers. Pure functions (no database) so the rules are unit-tested:
 *  - columns are found by header text, Thai or English, anywhere in the first rows of the first sheet
 *  - a Thai tax id is 13 digits; Excel drops the leading 0 when the column is numeric, so 12 digits are padded
 *  - a bad row is reported with its row number and left out; it never fails the whole file
 */

export interface ParsedRow {
  rowNo: number;
  taxId: string | null;
  companyName: string;
  amount: number;
}
export interface RowProblem {
  rowNo: number;
  message: string;
}
export interface ParsedFile {
  sheet: string;
  rows: ParsedRow[];
  problems: RowProblem[];
  /** sha256 of the parsed rows (not the file bytes): re-saving the same sheet is still recognised. */
  hash: string;
}

export const MAX_ROWS = 5000;

const HEADERS: Record<'taxId' | 'companyName' | 'amount', string[]> = {
  taxId: ['taxid', 'เลขประจำตัวผู้เสียภาษี', 'เลขประจำตัวผู้เสียภาษีอากร', 'เลขผู้เสียภาษี', 'เลขภาษี', 'เลขที่ผู้เสียภาษี'],
  companyName: ['companyname', 'company', 'customer', 'customername', 'ชื่อบริษัท', 'ชื่อลูกค้า', 'ลูกค้า', 'บริษัท', 'ชื่อกิจการ'],
  amount: ['income', 'revenue', 'amount', 'รายได้', 'ยอดรายได้', 'จำนวนเงิน', 'ยอดเงิน', 'มูลค่า'],
};
const headerKey = (s: string) => s.toLowerCase().replace(/[\s_.\-:()]/g, '');

/** Plain text of any exceljs cell value (rich text, formula result, hyperlink, date…). */
export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim();
  }
  return '';
}

/** "1,234.50", "฿ 1,234", "(500)" (accounting negative), 1234.5 → number; anything else → null. */
export function parseAmount(v: ExcelJS.CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'result' in v) return parseAmount(v.result as ExcelJS.CellValue);
  let s = cellText(v).replace(/[,\s฿]|บาท/g, '');
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return sign * Number(s);
}

/** Digits only; 12 digits = a 13-digit id whose leading 0 Excel dropped. Not 13 digits after that → null. */
export function normalizeTaxId(v: ExcelJS.CellValue | string | null | undefined): string | null {
  const digits = cellText(v ?? '').replace(/\D/g, '');
  if (digits.length === 12) return `0${digits}`;
  return digits.length === 13 ? digits : null;
}

/** "รวม", "ยอดรวม: …", "Total" — a summary line, not a customer. (No \b: it does not work after Thai letters.) */
const TOTAL_ROW = /^(รวมทั้งสิ้น|รวมทั้งหมด|ยอดรวม|รวม|grand\s*total|total|sum)(\s|:|$)/i;

export async function parseRevenueFile(buffer: Buffer): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new DomainError('FILE_FORMAT', 'อ่านไฟล์ไม่ได้ — รองรับเฉพาะไฟล์ Excel (.xlsx)');
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new DomainError('FILE_FORMAT', 'ไฟล์ไม่มีข้อมูล');

  // Header row: the first of the top 10 rows naming a company column and an amount column.
  let headerRow = 0;
  const col: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const found: typeof col = {};
    ws.getRow(r).eachCell((cell, c) => {
      const k = headerKey(cellText(cell.value));
      for (const [field, names] of Object.entries(HEADERS) as [keyof typeof HEADERS, string[]][]) {
        if (found[field] === undefined && names.some((n) => k === n || (n.length > 4 && k.includes(n)))) found[field] = c;
      }
    });
    if (found.companyName && found.amount) {
      headerRow = r;
      Object.assign(col, found);
    }
  }
  if (!headerRow) {
    throw new DomainError('FILE_FORMAT', 'ไม่พบหัวคอลัมน์ — ต้องมีคอลัมน์ชื่อบริษัท (companyname) และรายได้ (income) ส่วนเลขผู้เสียภาษี (taxid) แนะนำให้มี');
  }

  const rows: ParsedRow[] = [];
  const problems: RowProblem[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = cellText(row.getCell(col.companyName!).value).replace(/\s+/g, ' ');
    const rawTax = col.taxId ? row.getCell(col.taxId).value : null;
    const rawAmount = row.getCell(col.amount!).value;
    if (!name && !cellText(rawTax) && !cellText(rawAmount)) continue; // blank line
    const taxId = normalizeTaxId(rawTax);
    if (TOTAL_ROW.test(name) && !taxId) continue; // a "รวม" line under the data
    const amount = parseAmount(rawAmount);
    if (!name) problems.push({ rowNo: r, message: 'ไม่มีชื่อบริษัท' });
    else if (amount === null) problems.push({ rowNo: r, message: `รายได้ไม่ใช่ตัวเลข (“${cellText(rawAmount) || 'ว่าง'}”)` });
    else {
      if (cellText(rawTax) && !taxId) problems.push({ rowNo: r, message: `เลขผู้เสียภาษีไม่ครบ 13 หลัก (“${cellText(rawTax)}”) — นำเข้าโดยไม่ใช้เลขนี้` });
      rows.push({ rowNo: r, taxId, companyName: name, amount: Math.round(amount * 100) / 100 });
    }
    if (rows.length > MAX_ROWS) throw new DomainError('FILE_TOO_LARGE', `ไฟล์มีเกิน ${MAX_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายไฟล์`);
  }
  if (!rows.length) throw new DomainError('FILE_EMPTY', 'ไม่พบแถวรายได้ที่ใช้ได้ในไฟล์', undefined, { problems: problems.slice(0, 50) });
  const hash = createHash('sha256')
    .update(JSON.stringify(rows.map((x) => [x.taxId, x.companyName, x.amount])))
    .digest('hex');
  return { sheet: ws.name, rows, problems, hash };
}

// ---------------------------------------------------------------------------
// Matching rows to customers
// ---------------------------------------------------------------------------

export interface CustomerRef {
  id: string;
  code: string;
  name: string;
  taxId: string | null;
}
export type MatchStatus = 'TAX_ID' | 'NAME' | 'SUGGESTED' | 'UNMATCHED';
export interface Match {
  status: MatchStatus;
  customerId: string | null;
  /** Up to three likely customers when nothing matched for sure. */
  candidates: { id: string; score: number }[];
}

/** Thai legal forms (Thai has no spaces between words, so these are removed wherever they appear). */
const LEGAL_TH = ['บริษัทมหาชนจำกัด', 'ห้างหุ้นส่วนจำกัด', 'ห้างหุ้นส่วนสามัญ', 'ห้างหุ้นส่วน', 'บริษัท', 'จำกัด', 'มหาชน', 'หจก', 'บจก', 'บมจ'];
/** English legal forms: whole words only, so "Lincoln" keeps its "inc". */
const LEGAL_EN = new Set(['co', 'company', 'limited', 'ltd', 'public', 'pcl', 'inc', 'corp', 'corporation', 'plc']);

/** "บริษัท ตัวอย่าง จำกัด (มหาชน)" and "ตัวอย่าง" compare equal: legal form, spaces and punctuation removed. */
export function normalizeName(s: string): string {
  const words = s
    .toLowerCase()
    .replace(/[.,'"()\-_/&]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !LEGAL_EN.has(w));
  let n = words.join('');
  for (const w of LEGAL_TH) n = n.split(w).join('');
  return n;
}

/** Dice coefficient on character pairs (works for Thai, which has no spaces between words). */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // One name inside the other: strong, and closer lengths rank higher ("ตัวอย่างพลัส" beats "ตัวอย่าง").
  if (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) return 0.6 + 0.35 * (Math.min(a.length, b.length) / Math.max(a.length, b.length));
  const pairs = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  let common = 0;
  for (const [k, n] of pa) common += Math.min(n, pb.get(k) ?? 0);
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

/**
 * Tax id first (unique), then the normalised name (unique); otherwise up to three suggestions. Nothing is ever
 * matched on a guess: suggestions need a person to confirm.
 */
export function matchRows(rows: Pick<ParsedRow, 'taxId' | 'companyName'>[], customers: CustomerRef[]): Match[] {
  const byTax = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const normalized = customers.map((c) => ({ id: c.id, n: normalizeName(c.name) }));
  for (const c of customers) {
    const t = normalizeTaxId(c.taxId);
    if (t) byTax.set(t, [...(byTax.get(t) ?? []), c.id]);
  }
  for (const c of normalized) if (c.n) byName.set(c.n, [...(byName.get(c.n) ?? []), c.id]);

  return rows.map((r) => {
    const tax = r.taxId ? byTax.get(r.taxId) : undefined;
    if (tax?.length === 1) return { status: 'TAX_ID', customerId: tax[0], candidates: [] };
    const n = normalizeName(r.companyName);
    const name = byName.get(n);
    if (name?.length === 1) return { status: 'NAME', customerId: name[0], candidates: [] };
    const candidates = normalized
      .map((c) => ({ id: c.id, score: Math.round(similarity(n, c.n) * 100) / 100 }))
      .filter((c) => c.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    // Two customers sharing the same tax id or name: let a person choose between them.
    for (const id of [...(tax ?? []), ...(name ?? [])]) if (!candidates.some((c) => c.id === id)) candidates.unshift({ id, score: 1 });
    return { status: candidates.length ? 'SUGGESTED' : 'UNMATCHED', customerId: null, candidates: candidates.slice(0, 3) };
  });
}

/** Share of a period's amount that falls inside [from, to] (by days, inclusive). */
export function prorate(amount: number, period: { from: string; to: string }, range: { from: string; to: string }): number {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const start = Math.max(day(period.from), day(range.from));
  const end = Math.min(day(period.to), day(range.to));
  if (end < start) return 0;
  return (amount * (end - start + 1)) / (day(period.to) - day(period.from) + 1);
}
