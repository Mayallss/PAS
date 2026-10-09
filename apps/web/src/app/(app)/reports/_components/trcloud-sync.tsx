'use client';

/**
 * TRCLOUD (the group's companies PAS / PC / PA) → (1) contacts: one customer per client, linked to its contact in
 *              each company (code, name, address follow the highest-priority company); a contact matching nobody
 *              becomes a new customer
 *          → (2) invoices: revenue per invoice date, linked by that code.
 * Both preview first; the server fetches again when a person confirms. Each call uses TRCLOUD API quota.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CloudDownload, Link2, Receipt, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDate, thaiDateShort, todayBangkok } from '@/lib/format';
import { syncedAt, type TrcloudStatus, useTrcloudSync } from '@/lib/trcloud';
import { baht } from './explorer-data';

type Status = 'LINKED' | 'TAX_ID' | 'NAME' | 'SUGGESTED' | 'UNMATCHED';
interface ContactRow {
  company: string;
  /** "company:code" — decisions are keyed by it */
  key: string;
  contact: { code: string; name: string; taxId: string | null; address: string | null };
  status: Status;
  customerId: string | null;
  candidates: { id: string; score: number }[];
  /** Without a choice: link to customerId, create a new customer, join a customer created from another company's contact, or wait. */
  action: 'LINK' | 'NEW' | 'JOIN' | 'WAIT';
  joins: { code: string; name: string } | null;
  changes: { code: string | null; customerCode: string | null; name: string | null; taxId: 'FILL' | 'CONFLICT' | null; address: string | null } | null;
}
/** customer id, 'NEW' (create a customer) or null (leave alone) */
type Choice = string | null;
export interface ContactsResult {
  linked: number;
  created: number;
  renamed: number;
  recoded: number;
  reopened: number;
  removed: number;
  closed: number;
  taxIdFilled: number;
  taxIdConflicts: number;
  addressUpdated: number;
  needsDecision: number;
}
export const contactsSummary = (r: ContactsResult) =>
  [
    r.created && `ลูกค้าใหม่ ${r.created} ราย`,
    r.linked && `ผูกคู่ค้า ${r.linked} ราย`,
    r.recoded && `รหัสเปลี่ยนตาม TRCLOUD ${r.recoded}`,
    r.renamed && `ชื่อเปลี่ยนตาม TRCLOUD ${r.renamed}`,
    r.reopened && `เปิดใช้อีกครั้ง ${r.reopened}`,
    r.removed && `ลบ (ไม่มีใน TRCLOUD) ${r.removed}`,
    r.closed && `ปิด (ไม่มีใน TRCLOUD แต่มีงานอยู่) ${r.closed}`,
    r.taxIdFilled && `เติมเลขภาษี ${r.taxIdFilled}`,
    r.addressUpdated && `อัปเดตที่อยู่ ${r.addressUpdated}`,
    r.taxIdConflicts && `เลขภาษีไม่ตรง ${r.taxIdConflicts} ราย (ไม่ได้แก้)`,
    r.needsDecision && `รอเลือก ${r.needsDecision} ราย`,
  ]
    .filter(Boolean)
    .join(' · ') || 'ข้อมูลตรงกับ TRCLOUD แล้ว ไม่มีอะไรเปลี่ยน';
interface ContactsPreview {
  rows: ContactRow[];
  customers: { id: string; code: string; name: string; links: Record<string, string> }[];
}
interface BatchRef {
  id: string;
  fileName: string | null;
  periodFrom: string;
  periodTo: string;
  totalAmount: number;
}
interface InvoicesPreview {
  from: string;
  to: string;
  documents: number;
  total: number;
  creditNotes: number;
  cancelled: number;
  unmatched: { rows: number; amount: number; contacts: string[] };
  replaces: BatchRef[];
  excelOverlap: BatchRef[];
  creditNotesSupported: boolean;
  byCompany: { company: string; documents: number; total: number; cancelled: number; inGroup: number }[];
  /** invoices between the group's companies: not revenue */
  inGroup: number;
}

const STATUS: Record<Status, { label: string; tone: 'brand' | 'sky' | 'amber' | 'rose' | 'gray' }> = {
  LINKED: { label: 'ผูกไว้แล้ว', tone: 'gray' },
  TAX_ID: { label: 'ตรงเลขภาษี', tone: 'brand' },
  NAME: { label: 'ตรงชื่อ', tone: 'sky' },
  SUGGESTED: { label: 'ต้องเลือก', tone: 'amber' },
  UNMATCHED: { label: 'ลูกค้าใหม่', tone: 'rose' },
};
const selectClass = inputClass.replace('w-full', 'w-full min-w-48');
const prevMonth = () => {
  const [y, m] = todayBangkok().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export function TrcloudSync() {
  const { status, refresh } = useTrcloudSync();
  if (status.isLoading) return null;
  if (!status.data?.enabled) {
    return (
      <Card title="ดึงข้อมูลจาก TRCLOUD" description="คู่ค้า → ลูกค้า และใบแจ้งหนี้ → รายได้">
        <Alert tone="info">
          ยังไม่ได้เชื่อม TRCLOUD — ผู้ดูแลระบบใส่ค่า <code className="font-mono">TRCLOUD_BASE_URL · TRCLOUD_COMPANY_ID · TRCLOUD_PASSKEY · TRCLOUD_ENCRYPT_HEAD · TRCLOUD_ORIGIN</code> (จาก TRCLOUD → RESTFUL API → Setting → API Key) ในไฟล์ .env ของเซิร์ฟเวอร์ แล้วเริ่มระบบใหม่ ระหว่างนี้นำเข้าจาก Excel ด้านล่างได้ตามปกติ
        </Alert>
      </Card>
    );
  }
  return (
    <Card title="ดึงข้อมูลจาก TRCLOUD" description="ลูกค้าและรายได้ 12 เดือนล่าสุดซิงก์อัตโนมัติ · ① ใช้เลือกคู่ค้าที่ระบบไม่แน่ใจ · ② ใช้ดูหรือดึงช่วงเดือนอื่น · ทุกครั้งที่กดใช้โควตา API ของ TRCLOUD" bodyClassName="space-y-4 p-4 sm:p-5">
      <AutoSync status={status.data} refresh={refresh} />
      <ContactsSync />
      <InvoicesSync />
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** What the timer did last; "ซิงก์ตอนนี้" runs it now. */
function AutoSync({ status, refresh }: { status?: TrcloudStatus; refresh: ReturnType<typeof useTrcloudSync>['refresh'] }) {
  const inv = status?.lastInvoiceSync;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-brand-50/60 px-4 py-3 text-[13px] ring-1 ring-brand-100 ring-inset">
      <p className="min-w-0 flex-1 text-gray-800">
        {refresh.isPending ? (
          'กำลังซิงก์ลูกค้าและรายได้…'
        ) : inv ? (
          <>
            รายได้ซิงก์อัตโนมัติล่าสุด {syncedAt(inv.at)} · {thaiDateShort(inv.from)} – {thaiDate(inv.to)}: <b>{inv.rows.toLocaleString('th-TH')} ใบ · ฿{baht(inv.total)}</b>
            {Object.keys(inv.byCompany ?? {}).length > 1 && (
              <span className="text-gray-600">
                {' '}
                ({Object.entries(inv.byCompany).map(([co, x]) => `${co} ฿${baht(x.total)}`).join(' · ')})
              </span>
            )}
            {inv.unmatched > 0 && <span className="text-amber-800"> · {inv.unmatched} ใบยังไม่ผูกกับลูกค้า</span>}
          </>
        ) : (
          'ยังไม่เคยซิงก์รายได้อัตโนมัติ'
        )}
        {!!status?.companies.length && <span className="block text-[12px] text-gray-600">เชื่อมต่อ: {status.companies.join(' · ')}</span>}
        {refresh.isError && <span className="text-rose-700"> · ซิงก์ไม่สำเร็จ: {errorMessage(refresh.error)}</span>}
      </p>
      <Button size="sm" variant="ghost" onClick={() => refresh.mutate(true)} disabled={refresh.isPending}>
        <RefreshCw className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} aria-hidden /> ซิงก์ตอนนี้
      </Button>
    </div>
  );
}

function ContactsSync() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<ContactsPreview | null>(null);
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [onlyUnsure, setOnlyUnsure] = useState(true);
  const load = useMutation({
    mutationFn: () => api<ContactsPreview>('/revenue/trcloud/contacts/preview', { method: 'POST' }),
    onSuccess: (p) => {
      setPreview(p);
      setChoice({});
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () =>
      api<ContactsResult>('/revenue/trcloud/contacts/apply', {
        method: 'POST',
        body: { decisions: Object.entries(choice).map(([key, customerId]) => ({ key, customerId })) },
      }),
    onSuccess: (r) => {
      toast.success(contactsSummary(r));
      setPreview(null);
      for (const key of ['analytics', 'admin-customers', 'customers', 'trcloud-status']) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  /** "__auto" = joins the customer another company's contact creates (only shown on that row). */
  const customerOf = (r: ContactRow): Choice => (r.key in choice ? choice[r.key] : r.action === 'NEW' ? 'NEW' : r.action === 'JOIN' ? '__auto' : r.customerId);
  const unsure = (r: ContactRow) => r.status === 'SUGGESTED' || r.status === 'UNMATCHED' || r.changes?.taxId === 'CONFLICT';
  const created = preview ? preview.rows.filter((r) => customerOf(r) === 'NEW').length : 0;
  const rows = preview ? preview.rows.filter((r) => !onlyUnsure || unsure(r) || r.key in choice) : [];
  const count = (s: Status) => preview?.rows.filter((r) => r.status === s).length ?? 0;

  return (
    <section className="rounded-lg ring-1 ring-gray-300 ring-inset">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-gray-900">
            <Link2 className="h-4 w-4 text-brand-600" aria-hidden /> ① คู่ค้า → ลูกค้า
          </h3>
          <p className="text-[12.5px] text-gray-600">คู่ค้าที่ตรงกับลูกค้าเดิม (ชื่อ/เลขภาษี) จะผูกกัน ชื่อและที่อยู่ใช้ตาม TRCLOUD · คู่ค้าที่ไม่ตรงกับใครจะถูกสร้างเป็นลูกค้าใหม่ · เลขภาษีเติมให้เมื่อยังว่าง</p>
        </div>
        <Button onClick={() => load.mutate()} loading={load.isPending}>
          {!load.isPending && <CloudDownload className="h-4 w-4" aria-hidden />} ดึงรายชื่อคู่ค้า
        </Button>
      </header>
      {preview && (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(STATUS) as Status[]).map((s) => (
              <Badge key={s} tone={STATUS[s].tone}>
                {STATUS[s].label} {count(s)}
              </Badge>
            ))}
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[13px] text-gray-800">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyUnsure} onChange={(e) => setOnlyUnsure(e.target.checked)} />
              แสดงเฉพาะที่ต้องตรวจ
            </label>
          </div>
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-[13px]">
              <thead className="bg-gray-50 text-left text-[12px] text-gray-600">
                <tr className="border-y border-gray-200">
                  <th className="px-3 py-2 font-medium sm:pl-4">คู่ค้าใน TRCLOUD</th>
                  <th className="px-3 py-2 font-medium">สถานะ</th>
                  <th className="px-3 py-2 font-medium">ลูกค้าในระบบ</th>
                  <th className="px-3 py-2 font-medium sm:pr-4">จะเปลี่ยน</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cid = customerOf(r);
                  const candidates = r.candidates.map((c) => preview.customers.find((x) => x.id === c.id)).filter((x): x is ContactsPreview['customers'][number] => !!x);
                  return (
                    <tr key={r.key} className={`border-b border-gray-200 align-top ${!cid ? 'bg-amber-50/50' : ''}`}>
                      <td className="max-w-72 px-3 py-2 sm:pl-4">
                        <Badge tone="brand">{r.company}</Badge> <span className="font-mono text-[12px] text-gray-500">{r.contact.code}</span> <span className="text-gray-900">{r.contact.name}</span>
                        {r.contact.taxId && <span className="block font-mono text-[11.5px] text-gray-500">{r.contact.taxId}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={r.key in choice ? 'gray' : STATUS[r.status].tone}>{r.key in choice ? 'เลือกเอง' : r.action === 'JOIN' ? 'รวมกับลูกค้าใหม่' : STATUS[r.status].label}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`ลูกค้าของคู่ค้า ${r.company} ${r.contact.code}`}
                          className={selectClass}
                          value={cid ?? ''}
                          onChange={(e) => {
                            const { [r.key]: _, ...rest } = choice;
                            setChoice(e.target.value === '__auto' ? rest : { ...choice, [r.key]: e.target.value || null });
                          }}
                        >
                          <option value="">— ไม่ผูก (ข้ามไปก่อน)</option>
                          {r.joins && <option value="__auto">รวมกับลูกค้าใหม่ {r.joins.code} {r.joins.name}</option>}
                          <option value="NEW">+ สร้างเป็นลูกค้าใหม่</option>
                          {candidates.length > 0 && (
                            <optgroup label="ใกล้เคียง">
                              {candidates.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.code} {c.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="ลูกค้าทั้งหมด">
                            {preview.customers.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.code} {c.name}
                                {c.links[r.company] && c.links[r.company] !== r.contact.code ? ` (ผูกกับ ${r.company} ${c.links[r.company]} อยู่)` : ''}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </td>
                      <td className="max-w-64 px-3 py-2 text-[12.5px] text-gray-700 sm:pr-4">
                        {cid === 'NEW' ? (
                          <span>สร้างลูกค้าใหม่ รหัส {r.contact.code}</span>
                        ) : cid === '__auto' && r.joins ? (
                          <span>
                            ลูกค้ารายเดียวกับ {r.joins.code} (สร้างใหม่จากอีกบริษัท)
                          </span>
                        ) : cid && cid === r.customerId && r.changes ? (
                          <span className="flex flex-col gap-0.5">
                            {r.changes.code && <span>ผูกรหัส {r.changes.code}</span>}
                            {r.changes.name && <span className="truncate" title={r.changes.name}>ชื่อ: {r.changes.name}</span>}
                            {r.changes.taxId === 'FILL' && <span>เติมเลขภาษี</span>}
                            {r.changes.taxId === 'CONFLICT' && (
                              <span className="inline-flex items-start gap-1 text-amber-800">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> เลขภาษีไม่ตรงกับในระบบ — ไม่แก้ ตรวจด้วยมือ
                              </span>
                            )}
                            {r.changes.address && <span className="truncate" title={r.changes.address}>ที่อยู่: {r.changes.address}</span>}
                            {!r.changes.code && !r.changes.name && !r.changes.taxId && !r.changes.address && <span className="text-gray-500">ไม่มี</span>}
                          </span>
                        ) : cid ? (
                          <span>ผูกรหัส {r.contact.code} (ตามที่เลือก)</span>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-600">
                      ไม่มีรายการที่ต้องตรวจ — เอาติ๊ก “แสดงเฉพาะที่ต้องตรวจ” ออกเพื่อดูทั้งหมด
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPreview(null)}>ยกเลิก</Button>
            <Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>
              <CheckCircle2 className="h-4 w-4" aria-hidden /> บันทึก{created > 0 ? ` · สร้างลูกค้าใหม่ ${created} ราย` : ''}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function InvoicesSync() {
  const qc = useQueryClient();
  const last = prevMonth();
  const [from, setFrom] = useState(last);
  const [to, setTo] = useState(last);
  const [preview, setPreview] = useState<InvoicesPreview | null>(null);
  const [replaceExcel, setReplaceExcel] = useState<Record<string, boolean>>({});
  const ok = !!from && !!to && from <= to;
  const load = useMutation({
    mutationFn: () => api<InvoicesPreview>('/revenue/trcloud/invoices/preview', { method: 'POST', body: { from, to } }),
    onSuccess: (p) => {
      setPreview(p);
      setReplaceExcel({});
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const commit = useMutation({
    mutationFn: () =>
      api<{ rows: number; total: number; unmatched: number; replaced: number; changed: number; cleared: number }>('/revenue/trcloud/invoices/commit', {
        method: 'POST',
        body: { from, to, replaceExcelIds: Object.entries(replaceExcel).filter(([, v]) => v).map(([k]) => k) },
      }),
    onSuccess: (r) => {
      toast.success(`รายได้ ${r.rows} ใบ · ฿${baht(r.total)} · อัปเดต ${r.changed} เดือน${r.cleared ? ` · ล้าง ${r.cleared} เดือน (ยกเลิกหมด)` : ''}${r.replaced ? ` · แทนที่ Excel ${r.replaced} ชุด` : ''}`);
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ['revenue-batches'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section className="rounded-lg ring-1 ring-gray-300 ring-inset">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-gray-900">
            <Receipt className="h-4 w-4 text-brand-600" aria-hidden /> ② ใบแจ้งหนี้ → รายได้
          </h3>
          <p className="text-[12.5px] text-gray-600">จากรายงานใบแจ้งหนี้ (BL) · ยอดก่อน VAT · ไม่นับใบสถานะ Cancel · นับตามวันที่ของแต่ละใบ · เก็บทีละเดือน ดึงซ้ำ = แทนที่เดือนนั้น</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[12px] text-gray-600">ตั้งแต่เดือน</span>
            <input type="month" className={`${inputClass} w-40`} value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-gray-600">ถึงเดือน</span>
            <input type="month" className={`${inputClass} w-40`} value={to} min={from} onChange={(e) => { setTo(e.target.value); setPreview(null); }} />
          </label>
          <Button onClick={() => load.mutate()} loading={load.isPending} disabled={!ok}>
            {!load.isPending && <CloudDownload className="h-4 w-4" aria-hidden />} ดึงใบแจ้งหนี้
          </Button>
        </div>
      </header>
      {preview && (
        <div className="space-y-3 p-4 text-[13px]">
          <p className="text-gray-900">
            {thaiDateShort(preview.from)} – {thaiDate(preview.to)}: <b>{preview.documents.toLocaleString('th-TH')} ใบ · ฿{baht(preview.total)}</b>
            {preview.creditNotes > 0 && ` (รวมใบลดหนี้ ${preview.creditNotes} ใบ)`}
            {preview.cancelled > 0 && <span className="text-gray-600"> · ไม่นับใบที่ยกเลิก {preview.cancelled} ใบ</span>}
            {preview.inGroup > 0 && <span className="text-gray-600"> · ไม่นับใบระหว่างบริษัทในเครือ {preview.inGroup} ใบ</span>}
          </p>
          {preview.byCompany.length > 1 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-gray-700">
              {preview.byCompany.map((c) => (
                <li key={c.company}>
                  <Badge tone="brand">{c.company}</Badge> {c.documents.toLocaleString('th-TH')} ใบ · ฿{baht(c.total)}
                </li>
              ))}
            </ul>
          )}
          {!preview.creditNotesSupported && <p className="text-[12.5px] text-gray-600">ยังไม่ได้หักใบลดหนี้ — เพิ่มได้เมื่อยืนยัน endpoint ใบลดหนี้ใน TRCLOUD</p>}
          {preview.unmatched.rows > 0 && (
            <Alert tone="warning">
              {preview.unmatched.rows} ใบ (฿{baht(preview.unmatched.amount)}) เป็นของคู่ค้าที่ยังไม่ผูกกับลูกค้า — นับในรายได้รวม แต่ไม่อยู่ในกำไรรายลูกค้า · ทำ ① ก่อนแล้วดึงใหม่:{' '}
              <span className="font-mono text-[12px]">{preview.unmatched.contacts.slice(0, 8).join(' · ')}{preview.unmatched.contacts.length > 8 ? ' …' : ''}</span>
            </Alert>
          )}
          {preview.replaces.length > 0 && <p className="text-gray-700">จะแทนที่การดึงจาก TRCLOUD ครั้งก่อนของช่วงนี้ {preview.replaces.length} ชุด (ไม่นับซ้ำ)</p>}
          {preview.excelOverlap.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200 ring-inset">
              <p className="mb-2 font-medium text-amber-900">มีรายได้จาก Excel ในช่วงนี้ — ถ้าเป็นข้อมูลชุดเดียวกัน ให้ติ๊กเพื่อยกเลิก ไม่เช่นนั้นจะนับซ้ำ</p>
              {preview.excelOverlap.map((b) => (
                <label key={b.id} className="flex cursor-pointer items-start gap-2 text-gray-900">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={!!replaceExcel[b.id]} onChange={(e) => setReplaceExcel({ ...replaceExcel, [b.id]: e.target.checked })} />
                  <span>
                    {b.fileName} · {thaiDateShort(b.periodFrom)} – {thaiDate(b.periodTo)} · ฿{baht(b.totalAmount)}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPreview(null)}>ยกเลิก</Button>
            <Button variant="primary" loading={commit.isPending} disabled={!preview.documents} onClick={() => commit.mutate()}>
              <CheckCircle2 className="h-4 w-4" aria-hidden /> นำเข้า {preview.documents} ใบ · ฿{baht(preview.total)}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
