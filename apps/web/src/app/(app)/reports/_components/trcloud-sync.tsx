'use client';

/**
 * TRCLOUD → (1) contacts: link each TRCLOUD contact code to our customer (+ tax id, address)
 *          → (2) invoices: revenue per invoice date, linked by that code.
 * Both preview first; the server fetches again when a person confirms. Each call uses TRCLOUD API quota.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CloudDownload, Link2, Receipt } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDate, thaiDateShort, todayBangkok } from '@/lib/format';
import { baht } from './explorer-data';

type Status = 'LINKED' | 'TAX_ID' | 'NAME' | 'SUGGESTED' | 'UNMATCHED';
interface ContactRow {
  contact: { code: string; name: string; taxId: string | null; address: string | null };
  status: Status;
  customerId: string | null;
  candidates: { id: string; score: number }[];
  changes: { code: string | null; taxId: 'FILL' | 'CONFLICT' | null; address: string | null } | null;
}
interface ContactsPreview {
  rows: ContactRow[];
  customers: { id: string; code: string; name: string; trcloudCode: string | null }[];
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
}

const STATUS: Record<Status, { label: string; tone: 'brand' | 'sky' | 'amber' | 'rose' | 'gray' }> = {
  LINKED: { label: 'ผูกไว้แล้ว', tone: 'gray' },
  TAX_ID: { label: 'ตรงเลขภาษี', tone: 'brand' },
  NAME: { label: 'ตรงชื่อ', tone: 'sky' },
  SUGGESTED: { label: 'ต้องเลือก', tone: 'amber' },
  UNMATCHED: { label: 'ไม่พบ', tone: 'rose' },
};
const selectClass = inputClass.replace('w-full', 'w-full min-w-48');
const prevMonth = () => {
  const [y, m] = todayBangkok().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export function TrcloudSync() {
  const status = useQuery({ queryKey: ['trcloud-status'], queryFn: () => api<{ enabled: boolean }>('/revenue/trcloud/status'), staleTime: 60_000 });
  if (status.isLoading) return null;
  if (!status.data?.enabled) {
    return (
      <Card title="ดึงข้อมูลจาก TRCLOUD" description="คู่ค้า (รหัส, เลขภาษี, ที่อยู่) และใบแจ้งหนี้ → รายได้">
        <Alert tone="info">
          ยังไม่ได้เชื่อม TRCLOUD — ผู้ดูแลระบบใส่ค่า <code className="font-mono">TRCLOUD_BASE_URL · TRCLOUD_COMPANY_ID · TRCLOUD_PASSKEY · TRCLOUD_ENCRYPT_HEAD · TRCLOUD_ORIGIN</code> (จาก TRCLOUD → RESTFUL API → Setting → API Key) ในไฟล์ .env ของเซิร์ฟเวอร์ แล้วเริ่มระบบใหม่ ระหว่างนี้นำเข้าจาก Excel ด้านล่างได้ตามปกติ
        </Alert>
      </Card>
    );
  }
  return (
    <Card title="ดึงข้อมูลจาก TRCLOUD" description="ทำตามลำดับ: ① ผูกคู่ค้ากับลูกค้า (ครั้งแรก และเมื่อมีคู่ค้าใหม่) → ② ดึงใบแจ้งหนี้เป็นรายได้ · ทุกครั้งที่กดใช้โควตา API ของ TRCLOUD" bodyClassName="space-y-4 p-4 sm:p-5">
      <ContactsSync />
      <InvoicesSync />
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ContactsSync() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<ContactsPreview | null>(null);
  const [choice, setChoice] = useState<Record<string, string | null>>({});
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
      api<{ contacts: number; unlinked: number; linked: number; taxIdFilled: number; taxIdConflicts: number; addressUpdated: number }>('/revenue/trcloud/contacts/apply', {
        method: 'POST',
        body: { decisions: Object.entries(choice).map(([code, customerId]) => ({ code, customerId })) },
      }),
    onSuccess: (r) => {
      toast.success(`ผูกคู่ค้าใหม่ ${r.linked} ราย · เติมเลขภาษี ${r.taxIdFilled} · อัปเดตที่อยู่ ${r.addressUpdated}${r.taxIdConflicts ? ` · เลขภาษีไม่ตรง ${r.taxIdConflicts} ราย (ไม่ได้แก้)` : ''}`);
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const customerOf = (r: ContactRow) => (r.contact.code in choice ? choice[r.contact.code] : r.customerId);
  const unsure = (r: ContactRow) => r.status === 'SUGGESTED' || r.status === 'UNMATCHED' || r.changes?.taxId === 'CONFLICT';
  const rows = preview ? preview.rows.filter((r) => !onlyUnsure || unsure(r) || r.contact.code in choice) : [];
  const count = (s: Status) => preview?.rows.filter((r) => r.status === s).length ?? 0;

  return (
    <section className="rounded-lg ring-1 ring-gray-300 ring-inset">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-gray-900">
            <Link2 className="h-4 w-4 text-brand-600" aria-hidden /> ① คู่ค้า → ลูกค้า
          </h3>
          <p className="text-[12.5px] text-gray-600">จับคู่ด้วยชื่อ/เลขภาษี แล้วเก็บรหัสคู่ค้า TRCLOUD ไว้กับลูกค้า · เลขภาษีเติมให้เมื่อยังว่าง · ที่อยู่ใช้ตาม TRCLOUD</p>
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
                    <tr key={r.contact.code} className={`border-b border-gray-200 align-top ${!cid ? 'bg-amber-50/50' : ''}`}>
                      <td className="max-w-72 px-3 py-2 sm:pl-4">
                        <span className="font-mono text-[12px] text-gray-500">{r.contact.code}</span> <span className="text-gray-900">{r.contact.name}</span>
                        {r.contact.taxId && <span className="block font-mono text-[11.5px] text-gray-500">{r.contact.taxId}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={r.contact.code in choice ? 'gray' : STATUS[r.status].tone}>{r.contact.code in choice ? 'เลือกเอง' : STATUS[r.status].label}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <select aria-label={`ลูกค้าของคู่ค้า ${r.contact.code}`} className={selectClass} value={cid ?? ''} onChange={(e) => setChoice({ ...choice, [r.contact.code]: e.target.value || null })}>
                          <option value="">— ไม่ผูก</option>
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
                                {c.trcloudCode && c.trcloudCode !== r.contact.code ? ` (ผูกกับ ${c.trcloudCode} อยู่)` : ''}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </td>
                      <td className="max-w-64 px-3 py-2 text-[12.5px] text-gray-700 sm:pr-4">
                        {cid && cid === r.customerId && r.changes ? (
                          <span className="flex flex-col gap-0.5">
                            {r.changes.code && <span>ผูกรหัส {r.changes.code}</span>}
                            {r.changes.taxId === 'FILL' && <span>เติมเลขภาษี</span>}
                            {r.changes.taxId === 'CONFLICT' && (
                              <span className="inline-flex items-start gap-1 text-amber-800">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> เลขภาษีไม่ตรงกับในระบบ — ไม่แก้ ตรวจด้วยมือ
                              </span>
                            )}
                            {r.changes.address && <span className="truncate" title={r.changes.address}>ที่อยู่: {r.changes.address}</span>}
                            {!r.changes.code && !r.changes.taxId && !r.changes.address && <span className="text-gray-500">ไม่มี</span>}
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
              <CheckCircle2 className="h-4 w-4" aria-hidden /> บันทึกการจับคู่
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
      api<{ rows: number; total: number; unmatched: number; replaced: number }>('/revenue/trcloud/invoices/commit', {
        method: 'POST',
        body: { from, to, replaceExcelIds: Object.entries(replaceExcel).filter(([, v]) => v).map(([k]) => k) },
      }),
    onSuccess: (r) => {
      toast.success(`นำเข้ารายได้ ${r.rows} ใบ · ฿${baht(r.total)}${r.replaced ? ` · แทนที่ชุดเดิม ${r.replaced}` : ''}`);
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
          <p className="text-[12.5px] text-gray-600">ยอดก่อน VAT · ไม่นับใบที่ยกเลิก · นับตามวันที่ของแต่ละใบ · ดึงเดือนเดิมซ้ำ = แทนที่ของเดิม</p>
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
          </p>
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
