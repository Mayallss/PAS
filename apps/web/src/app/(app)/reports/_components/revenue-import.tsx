'use client';

/**
 * รายได้ (นำเข้า): Excel → preview (match to customers) → confirm → history.
 * The server parses the file twice (preview and commit) so amounts only ever come from the file; this page sends
 * the period and people's decisions for rows the matcher was unsure about.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, History, Upload, X } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, Dialog, Empty, inputClass, Loading } from '@/components/ui';
import { api, apiUpload, errorMessage } from '@/lib/api';
import { addDays, thaiDate, thaiDateShort, todayBangkok } from '@/lib/format';
import { baht } from './explorer-data';
import { TrcloudSync } from './trcloud-sync';

type Status = 'TAX_ID' | 'NAME' | 'SUGGESTED' | 'UNMATCHED';
interface Customer {
  id: string;
  code: string;
  name: string;
  taxId?: string | null;
}
interface PreviewRow {
  rowNo: number;
  taxId: string | null;
  companyName: string;
  amount: number;
  match: { status: Status; customerId: string | null; candidates: { id: string; score: number }[] };
}
interface Preview {
  fileName: string;
  sheet: string;
  contentHash: string;
  rows: PreviewRow[];
  problems: { rowNo: number; message: string }[];
  total: number;
  duplicate: { id: string; periodFrom: string; periodTo: string; createdAt: string; fileName: string | null } | null;
  customers: Customer[];
}
interface Batch {
  id: string;
  source: 'EXCEL' | 'API';
  fileName: string | null;
  periodFrom: string;
  periodTo: string;
  rowCount: number;
  totalAmount: number;
  unmatched: { rows: number; amount: number };
  note: string | null;
  createdBy: string;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

const STATUS: Record<Status, { label: string; tone: 'brand' | 'sky' | 'amber' | 'rose' }> = {
  TAX_ID: { label: 'ตรงเลขภาษี', tone: 'brand' },
  NAME: { label: 'ตรงชื่อ', tone: 'sky' },
  SUGGESTED: { label: 'ต้องเลือก', tone: 'amber' },
  UNMATCHED: { label: 'ไม่พบ', tone: 'rose' },
};
const selectClass = inputClass.replace('w-full', 'w-full min-w-48');
const monthEnd = (month: string) => addDays(`${nextMonth(month)}-01`, -1);
function nextMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
function prevMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
const periodText = (from: string, to: string) => (from.slice(0, 7) === to.slice(0, 7) ? thaiDate(from).replace(/^1 /, '') : `${thaiDateShort(from)} – ${thaiDate(to)}`);
const overlaps = (a: { periodFrom: string; periodTo: string }, from: string, to: string) => a.periodFrom <= to && a.periodTo >= from;

export function RevenueImport() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [drag, setDrag] = useState(false);
  const last = prevMonth(todayBangkok().slice(0, 7));
  const [fromMonth, setFromMonth] = useState(last);
  const [toMonth, setToMonth] = useState(last);
  const [choice, setChoice] = useState<Record<number, string | null>>({});
  const [onlyUnsure, setOnlyUnsure] = useState(true);
  const [remember, setRemember] = useState(true);
  const [replace, setReplace] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [done, setDone] = useState<{ rows: number; total: number; unmatched: number; replaced: number; taxIdsRemembered: number; from: string; to: string } | null>(null);

  const batches = useQuery({ queryKey: ['revenue-batches'], queryFn: () => api<Batch[]>('/revenue/batches') });
  const periodFrom = `${fromMonth}-01`;
  const periodTo = monthEnd(toMonth);
  const periodOk = !!fromMonth && !!toMonth && fromMonth <= toMonth;
  const overlapping = (batches.data ?? []).filter((b) => !b.voidedAt && periodOk && overlaps(b, periodFrom, periodTo));

  const check = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return apiUpload<Preview>('/revenue/preview', form);
    },
    onSuccess: (p) => {
      setPreview(p);
      setChoice({});
      setReplace({});
      setDone(null);
      setOnlyUnsure(p.rows.some((r) => r.match.status === 'SUGGESTED' || r.match.status === 'UNMATCHED'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const commit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      // meta first: multer reads fields before the file stream.
      form.append(
        'meta',
        JSON.stringify({
          contentHash: preview!.contentHash,
          periodFrom,
          periodTo,
          decisions: Object.entries(choice).map(([rowNo, customerId]) => ({ rowNo: Number(rowNo), customerId })),
          rememberTaxIds: remember,
          replaceBatchIds: overlapping.filter((b) => replace[b.id] ?? true).map((b) => b.id),
          note: note.trim() || undefined,
        }),
      );
      form.append('file', file!);
      return apiUpload<{ rows: number; total: number; unmatched: number; replaced: number; taxIdsRemembered: number }>('/revenue/batches', form);
    },
    onSuccess: (r) => {
      setDone({ ...r, from: periodFrom, to: periodTo });
      setPreview(null);
      setFile(null);
      void qc.invalidateQueries({ queryKey: ['revenue-batches'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function pick(f: File | undefined | null) {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      toast.error('รองรับเฉพาะไฟล์ Excel (.xlsx) — ถ้าเป็น .xls หรือ .csv ให้เปิดใน Excel แล้ว “บันทึกเป็น” .xlsx');
      return;
    }
    setFile(f);
    check.mutate(f);
  }

  const customerOf = (r: PreviewRow) => (r.rowNo in choice ? choice[r.rowNo] : r.match.customerId);
  const counts = preview
    ? (['TAX_ID', 'NAME', 'SUGGESTED', 'UNMATCHED'] as Status[]).map((s) => [s, preview.rows.filter((r) => r.match.status === s).length] as const)
    : [];
  const stillOpen = preview ? preview.rows.filter((r) => !customerOf(r)) : [];
  const rows = preview ? preview.rows.filter((r) => !onlyUnsure || r.match.status === 'SUGGESTED' || r.match.status === 'UNMATCHED' || r.rowNo in choice) : [];

  return (
    <div className="min-w-0 space-y-4">
      {done && (
        <Alert tone="success">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> นำเข้าแล้ว {done.rows.toLocaleString('th-TH')} แถว · ฿{baht(done.total)} · {periodText(done.from, done.to)}
            </span>
            {done.unmatched > 0 && <span>ยังไม่จับคู่ {done.unmatched} แถว (จับคู่ได้ในประวัติด้านล่าง)</span>}
            {done.replaced > 0 && <span>แทนที่ชุดเดิม {done.replaced} ชุด</span>}
            {done.taxIdsRemembered > 0 && <span>จำเลขภาษีให้ลูกค้า {done.taxIdsRemembered} ราย</span>}
            <Link href={`/reports?tab=customers&from=${done.from}&to=${done.to}`} className="font-medium underline">
              ดูกำไร–ขาดทุนช่วงนี้ →
            </Link>
          </span>
        </Alert>
      )}

      <TrcloudSync />

      {/* ---------- step 1: file ---------- */}
      {!preview && (
        <Card
          title="นำเข้ารายได้จาก Excel"
          description="คอลัมน์ที่ใช้: taxid (เลขประจำตัวผู้เสียภาษี) · companyname (ชื่อบริษัท) · income (รายได้) — หัวคอลัมน์ภาษาไทยก็ได้"
          actions={
            <a href="/api/revenue/template" className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium text-gray-800 shadow-card ring-1 ring-gray-300 ring-inset hover:bg-gray-50">
              <Download className="h-4 w-4" aria-hidden /> ไฟล์ตัวอย่าง
            </a>
          }
        >
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files[0]);
            }}
            disabled={check.isPending}
            className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-gray-400 hover:border-brand-400 hover:bg-gray-50'}`}
          >
            {check.isPending ? (
              <span className="text-sm text-gray-700">กำลังอ่านไฟล์และจับคู่ลูกค้า…</span>
            ) : (
              <>
                <FileSpreadsheet className="h-8 w-8 text-brand-600" aria-hidden />
                <span className="text-sm font-medium text-gray-900">เลือกไฟล์ .xlsx หรือลากมาวางที่นี่</span>
                <span className="text-[12.5px] text-gray-600">ยังไม่บันทึกอะไร — จะแสดงให้ตรวจก่อนทุกครั้ง</span>
              </>
            )}
          </button>
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </Card>
      )}

      {/* ---------- step 2: check ---------- */}
      {preview && (
        <Card
          className="min-w-0"
          title={`ตรวจก่อนนำเข้า: ${preview.fileName}`}
          description={`${preview.rows.length.toLocaleString('th-TH')} แถว · รวม ฿${baht(preview.total)} · ชีต “${preview.sheet}”`}
          actions={
            <Button onClick={() => setPreview(null)}>
              <X className="h-4 w-4" aria-hidden /> เลือกไฟล์ใหม่
            </Button>
          }
          bodyClassName="space-y-4 p-4 sm:p-5"
        >
          {preview.duplicate && (
            <Alert tone="warning">
              ไฟล์นี้ (ข้อมูลเดียวกัน) เคยนำเข้าแล้ว เป็นรายได้ {periodText(preview.duplicate.periodFrom, preview.duplicate.periodTo)} เมื่อ {thaiDateShort(preview.duplicate.createdAt.slice(0, 10))} — ถ้านำเข้าซ้ำในช่วงเดียวกันให้เลือก “แทนที่” ด้านล่าง ไม่เช่นนั้นรายได้จะนับสองครั้ง
            </Alert>
          )}

          <fieldset className="grid gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
            <legend className="mb-2 text-[13px] font-medium text-gray-800">รายได้นี้เป็นของเดือน</legend>
            <label className="block">
              <span className="mb-1 block text-[12.5px] text-gray-600">ตั้งแต่เดือน</span>
              <input type="month" className={`${inputClass} sm:w-44`} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12.5px] text-gray-600">ถึงเดือน</span>
              <input type="month" className={`${inputClass} sm:w-44`} value={toMonth} min={fromMonth} onChange={(e) => setToMonth(e.target.value)} />
            </label>
            <p className="text-[12.5px] text-gray-600 sm:pb-2">{periodOk ? `= ${periodText(periodFrom, periodTo)} · ถ้ารายงานดูช่วงสั้นกว่านี้ จะเฉลี่ยตามจำนวนวัน` : 'เดือนเริ่มต้องไม่เกินเดือนสิ้นสุด'}</p>
          </fieldset>

          {overlapping.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200 ring-inset">
              <p className="mb-2 text-[13px] font-medium text-amber-900">มีรายได้ที่นำเข้าไว้แล้วในช่วงนี้ — ติ๊กเพื่อยกเลิกชุดเดิม (แทนที่) ไม่ติ๊ก = เก็บไว้ทั้งคู่</p>
              <ul className="space-y-1.5">
                {overlapping.map((b) => (
                  <li key={b.id}>
                    <label className="flex cursor-pointer items-start gap-2 text-[13px] text-gray-900">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={replace[b.id] ?? true} onChange={(e) => setReplace({ ...replace, [b.id]: e.target.checked })} />
                      <span>
                        {periodText(b.periodFrom, b.periodTo)} · {b.fileName ?? 'จากระบบ'} · ฿{baht(b.totalAmount)} · {b.rowCount} แถว · นำเข้าโดย {b.createdBy}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {counts.map(([s, n]) => (
              <Badge key={s} tone={STATUS[s].tone}>
                {STATUS[s].label} {n}
              </Badge>
            ))}
            {preview.problems.length > 0 && <Badge tone="gray">ข้ามแถวที่มีปัญหา {preview.problems.length}</Badge>}
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[13px] text-gray-800">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyUnsure} onChange={(e) => setOnlyUnsure(e.target.checked)} />
              แสดงเฉพาะแถวที่ต้องตรวจ
            </label>
          </div>

          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[44rem] text-[13px]">
              <thead className="bg-gray-50 text-left text-[12px] text-gray-600">
                <tr className="border-y border-gray-200">
                  <th className="px-3 py-2 font-medium sm:pl-5">แถว</th>
                  <th className="px-3 py-2 font-medium">เลขผู้เสียภาษี</th>
                  <th className="px-3 py-2 font-medium">ชื่อในไฟล์</th>
                  <th className="px-3 py-2 text-right font-medium">รายได้</th>
                  <th className="px-3 py-2 font-medium">สถานะ</th>
                  <th className="px-3 py-2 font-medium sm:pr-5">ลูกค้าในระบบ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cid = customerOf(r);
                  const candidates = r.match.candidates.map((c) => preview.customers.find((x) => x.id === c.id)).filter((x): x is Customer => !!x);
                  return (
                    <tr key={r.rowNo} className={`border-b border-gray-200 align-middle ${!cid ? 'bg-amber-50/50' : ''}`}>
                      <td className="px-3 py-2 text-gray-600 tabular-nums sm:pl-5">{r.rowNo}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-gray-700">{r.taxId ?? '–'}</td>
                      <td className="max-w-64 px-3 py-2 text-gray-900">{r.companyName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{baht(r.amount)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={r.rowNo in choice ? 'gray' : STATUS[r.match.status].tone}>{r.rowNo in choice ? 'เลือกเอง' : STATUS[r.match.status].label}</Badge>
                      </td>
                      <td className="px-3 py-2 sm:pr-5">
                        <select
                          aria-label={`ลูกค้าของแถว ${r.rowNo}`}
                          className={selectClass}
                          value={cid ?? ''}
                          onChange={(e) => setChoice({ ...choice, [r.rowNo]: e.target.value || null })}
                        >
                          <option value="">— ยังไม่จับคู่ (จับคู่ภายหลังได้)</option>
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
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-gray-600">
                      ทุกแถวจับคู่ได้แล้ว — เอาติ๊ก “แสดงเฉพาะแถวที่ต้องตรวจ” ออกเพื่อดูทั้งหมด
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {preview.problems.length > 0 && (
            <details className="rounded-lg ring-1 ring-gray-200">
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-gray-800">แถวที่ข้าม / ข้อสังเกต ({preview.problems.length})</summary>
              <ul className="space-y-1 px-3 pb-3 text-[12.5px] text-gray-700">
                {preview.problems.map((p) => (
                  <li key={`${p.rowNo}-${p.message}`}>
                    แถว {p.rowNo}: {p.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-gray-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>จำเลขผู้เสียภาษีไว้กับลูกค้าที่เลือก (เฉพาะลูกค้าที่ยังไม่มีเลข) — ครั้งหน้าจะจับคู่ให้เองทันที</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-gray-600">หมายเหตุ (ไม่บังคับ)</span>
            <input className={inputClass} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ยอดจากระบบบัญชี ณ 5 ต.ค." />
          </label>

          <div className="flex flex-col gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-gray-700">
              {stillOpen.length > 0 ? (
                <span className="inline-flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden /> ยังไม่จับคู่ {stillOpen.length} แถว (฿{baht(stillOpen.reduce((a, r) => a + r.amount, 0))}) — นับในรายได้รวม แต่ไม่อยู่ในกำไรรายลูกค้าจนกว่าจะจับคู่
                </span>
              ) : (
                'ทุกแถวจับคู่กับลูกค้าแล้ว'
              )}
            </p>
            <Button variant="primary" className="h-10" loading={commit.isPending} disabled={!periodOk} onClick={() => commit.mutate()}>
              <Upload className="h-4 w-4" aria-hidden /> นำเข้า {preview.rows.length.toLocaleString('th-TH')} แถว · ฿{baht(preview.total)}
            </Button>
          </div>
        </Card>
      )}

      <BatchHistory batches={batches.data} loading={batches.isLoading} error={batches.error} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function BatchHistory({ batches, loading, error }: { batches?: Batch[]; loading: boolean; error: unknown }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<Batch | null>(null);
  const [reason, setReason] = useState('');
  const voidBatch = useMutation({
    mutationFn: () => api(`/revenue/batches/${voiding!.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('ยกเลิกชุดรายได้แล้ว');
      setVoiding(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['revenue-batches'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card title="ประวัติการนำเข้า" description="ชุดที่ยกเลิกแล้วไม่ถูกนับในรายงาน แต่เก็บไว้เป็นหลักฐาน" bodyClassName="p-0">
      {loading ? (
        <div className="p-5">
          <Loading rows={3} />
        </div>
      ) : error ? (
        <div className="p-5">
          <Alert tone="error">{errorMessage(error)}</Alert>
        </div>
      ) : !batches?.length ? (
        <Empty icon={<History className="h-5 w-5" />} title="ยังไม่เคยนำเข้ารายได้" />
      ) : (
        <ul className="divide-y divide-gray-200">
          {batches.map((b) => (
            <li key={b.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 ${b.voidedAt ? 'bg-gray-50 text-gray-500' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className={`text-[13.5px] font-medium ${b.voidedAt ? 'text-gray-600 line-through' : 'text-gray-900'}`}>
                  {periodText(b.periodFrom, b.periodTo)} · ฿{baht(b.totalAmount)}
                </p>
                <p className="truncate text-[12.5px] text-gray-600">
                  {b.fileName ?? 'ดึงจากระบบ'} · {b.rowCount} {b.source === 'API' ? 'ใบ' : 'แถว'} · {b.createdBy} · {thaiDateShort(b.createdAt.slice(0, 10))}
                  {b.note && ` · ${b.note}`}
                </p>
                {b.voidedAt && (
                  <p className="text-[12.5px] text-gray-600">
                    ยกเลิกโดย {b.voidedBy} · {b.voidReason}
                  </p>
                )}
              </div>
              {!b.voidedAt && b.unmatched.rows > 0 && (
                <Badge tone="amber">
                  ยังไม่จับคู่ {b.unmatched.rows} แถว · ฿{baht(b.unmatched.amount)}
                </Badge>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setOpen(b.id)}>
                  {!b.voidedAt && b.unmatched.rows ? 'จับคู่' : 'ดูรายการ'}
                </Button>
                {!b.voidedAt && (
                  <Button size="sm" variant="danger" onClick={() => setVoiding(b)}>
                    ยกเลิก
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <BatchDialog id={open} onClose={() => setOpen(null)} />}
      {voiding && (
        <Dialog
          open
          onClose={() => setVoiding(null)}
          title="ยกเลิกชุดรายได้นี้?"
          footer={
            <>
              <Button onClick={() => setVoiding(null)}>ไม่ยกเลิก</Button>
              <Button variant="primary" loading={voidBatch.isPending} disabled={!reason.trim()} onClick={() => voidBatch.mutate()}>
                ยืนยันยกเลิก
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-gray-700">
            {periodText(voiding.periodFrom, voiding.periodTo)} · ฿{baht(voiding.totalAmount)} จะไม่ถูกนับในรายงานอีก (ข้อมูลยังเก็บไว้เป็นหลักฐาน)
          </p>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-gray-800">เหตุผล</span>
            <input className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="เช่น นำเข้าผิดเดือน" />
          </label>
        </Dialog>
      )}
    </Card>
  );
}

function BatchDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['revenue-batch', id],
    queryFn: () =>
      api<{ id: string; periodFrom: string; periodTo: string; fileName: string | null; voided: boolean; entries: { id: string; rowNo: number; taxId: string | null; companyName: string; amount: number; matchedBy: string | null; customer: Customer | null }[]; customers: Customer[] }>(
        `/revenue/batches/${id}`,
      ),
  });
  const assign = useMutation({
    mutationFn: (v: { entryId: string; customerId: string | null }) => api<{ taxIdRemembered: boolean }>(`/revenue/entries/${v.entryId}`, { method: 'PATCH', body: { customerId: v.customerId, remember: true } }),
    onSuccess: (r) => {
      toast.success(r.taxIdRemembered ? 'จับคู่แล้ว และจำเลขผู้เสียภาษีไว้กับลูกค้า' : 'บันทึกการจับคู่แล้ว');
      void qc.invalidateQueries({ queryKey: ['revenue-batch', id] });
      void qc.invalidateQueries({ queryKey: ['revenue-batches'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  return (
    <Dialog wide open onClose={onClose} title={d ? `${periodText(d.periodFrom, d.periodTo)} · ${d.fileName ?? 'จากระบบ'}` : 'รายการรายได้'}>
      {q.isLoading ? (
        <Loading rows={4} />
      ) : q.error ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[36rem] text-[12.5px]">
            <thead className="sticky top-0 bg-white text-left text-gray-600">
              <tr className="border-b border-gray-200">
                <th className="py-1.5 pr-2 font-medium">แถว</th>
                <th className="py-1.5 pr-2 font-medium">ชื่อในไฟล์</th>
                <th className="py-1.5 pr-2 text-right font-medium">รายได้</th>
                <th className="py-1.5 font-medium">ลูกค้า</th>
              </tr>
            </thead>
            <tbody>
              {d!.entries.map((e) => (
                <tr key={e.id} className={`border-b border-gray-200 ${!e.customer ? 'bg-amber-50/60' : ''}`}>
                  <td className="py-1.5 pr-2 text-gray-600 tabular-nums">{e.rowNo}</td>
                  <td className="py-1.5 pr-2">
                    {e.companyName}
                    {e.taxId && <span className="block font-mono text-[11.5px] text-gray-500">{e.taxId}</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{baht(e.amount)}</td>
                  <td className="py-1.5">
                    {d!.voided ? (
                      (e.customer && `${e.customer.code} ${e.customer.name}`) || '–'
                    ) : (
                      <select aria-label={`ลูกค้าของแถว ${e.rowNo}`} className={selectClass} value={e.customer?.id ?? ''} disabled={assign.isPending} onChange={(ev) => assign.mutate({ entryId: e.id, customerId: ev.target.value || null })}>
                        <option value="">— ยังไม่จับคู่</option>
                        {d!.customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
