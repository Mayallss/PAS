'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, FileText, Inbox, Laptop, MessageSquare, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { type AssetOptions, type ItRequest, REQUEST_STATUS_META, REQUEST_TYPE_LABEL, requestNo, type RequestStatus, STATE_META } from '@/lib/assets';
import { thaiDate, thaiDateShort, todayBangkok } from '@/lib/format';
import { VendorSelect } from './pickers';

const time = (iso: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const day = (iso: string) => thaiDateShort(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(iso)));

function StatusBadge({ status }: { status: RequestStatus }) {
  const m = REQUEST_STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

/** A request with its progress log — used for "my requests" and inside the IT queue. */
export function RequestCard({ r, showRequester, actions }: { r: ItRequest; showRequester?: boolean; actions?: React.ReactNode }) {
  return (
    <article className="rounded-xl bg-white p-4 shadow-card ring-1 ring-gray-200/80">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-500">
            <span className="font-mono">{requestNo(r.number)}</span> · {REQUEST_TYPE_LABEL[r.type]} · {day(r.createdAt)} {time(r.createdAt)}
            {r.urgency === 'URGENT' && <span className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-rose-600"><AlertTriangle className="h-3 w-3" /> ด่วน</span>}
          </p>
          <p className="mt-0.5 text-[14px] font-medium text-gray-900">{r.title}</p>
          {showRequester && (
            <p className="text-[12px] text-gray-600">
              {r.requester.fullName}{r.requester.nickname && ` (${r.requester.nickname})`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {r.asset && (
            <span className="inline-flex items-center gap-1 text-[12px] text-gray-600">
              <Laptop className="h-3.5 w-3.5" />
              {showRequester ? <Link href={`/it-assets/${encodeURIComponent(r.asset.code)}`} className="font-mono text-brand-700 hover:underline">{r.asset.code}</Link> : <span className="font-mono">{r.asset.code}</span>}
              <Badge tone={STATE_META[r.asset.state].tone}>{STATE_META[r.asset.state].label}</Badge>
            </span>
          )}
          <StatusBadge status={r.status} />
        </div>
      </div>
      {r.detail && <p className="mt-2 text-[13px] whitespace-pre-line text-gray-600">{r.detail}</p>}
      {!!r.attachments.length && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {r.attachments.map((f) => {
            const href = `/api/it-requests/${r.id}/attachments/${f.id}/file`;
            const img = f.mimeType.startsWith('image/') && f.mimeType !== 'image/heic';
            return (
              <li key={f.id}>
                <a href={href} target="_blank" rel="noopener noreferrer" title={f.fileName} className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated file from our own API */}
                  {img ? <img src={href} alt={f.fileName} className="h-full w-full object-cover" /> : <FileText className="h-5 w-5 text-gray-500" />}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <ol className="mt-3 space-y-1.5 border-l-2 border-gray-100 pl-3">
        {r.updates.map((u) => (
          <li key={u.id} className="text-[12px]">
            <span className="text-gray-400">{day(u.createdAt)} {time(u.createdAt)}</span>{' '}
            {u.fromStatus !== null || u.toStatus === 'SUBMITTED' ? (
              <span className="font-medium text-gray-700">{u.toStatus === 'SUBMITTED' ? 'ส่งคำขอ' : REQUEST_STATUS_META[u.toStatus].label}</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-gray-700"><MessageSquare className="h-3 w-3" /> อัปเดต</span>
            )}
            <span className="text-gray-500"> · {u.by}</span>
            {u.note && <p className="text-gray-600">{u.note}</p>}
          </li>
        ))}
      </ol>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}

// ---------------------------------------------------------------------------

/** IT/Admin work queue. */
export function RequestQueue({ canHandle }: { canHandle: boolean }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [handling, setHandling] = useState<ItRequest | null>(null);
  const q = useQuery({ queryKey: ['it-requests', scope], queryFn: () => api<ItRequest[]>('/it-requests', { query: { scope } }) });
  const options = useQuery({ queryKey: ['asset-options'], queryFn: () => api<AssetOptions>('/assets/options'), enabled: canHandle });
  const done = () => {
    setHandling(null);
    void qc.invalidateQueries({ queryKey: ['it-requests'] });
    void qc.invalidateQueries({ queryKey: ['assets'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  return (
    <div className="space-y-3">
      <div role="tablist" className="inline-flex rounded-lg bg-gray-100 p-1">
        {(['OPEN', 'CLOSED'] as const).map((k) => (
          <button key={k} role="tab" type="button" aria-selected={scope === k} onClick={() => setScope(k)} className={`h-8 rounded-md px-3 text-[13px] font-medium ${scope === k ? 'bg-white shadow-card' : 'text-gray-500'}`}>
            {k === 'OPEN' ? 'ค้างอยู่' : 'ปิดแล้ว'}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Loading rows={4} />
      ) : q.error ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : !q.data?.length ? (
        <Empty icon={<Inbox className="h-5 w-5" />} title={scope === 'OPEN' ? 'ไม่มีคำขอค้าง' : 'ยังไม่มีคำขอที่ปิดแล้ว'} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {q.data.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              showRequester
              actions={
                canHandle && (r.status === 'SUBMITTED' || r.status === 'IN_PROGRESS') ? (
                  <Button size="sm" variant={r.status === 'SUBMITTED' ? 'primary' : 'secondary'} onClick={() => setHandling(r)}>
                    {r.status === 'SUBMITTED' ? 'รับเรื่อง / ตอบ' : 'อัปเดต / ปิดงาน'}
                  </Button>
                ) : null
              }
            />
          ))}
        </div>
      )}
      {handling && options.data && <HandleDialog r={handling} options={options.data} onClose={() => setHandling(null)} onDone={done} />}
    </div>
  );
}

function HandleDialog({ r, options, onClose, onDone }: { r: ItRequest; options: AssetOptions; onClose: () => void; onDone: () => void }) {
  const next: RequestStatus[] = r.status === 'SUBMITTED' ? ['IN_PROGRESS', 'RESOLVED', 'REJECTED'] : ['IN_PROGRESS', 'RESOLVED', 'REJECTED'];
  const [status, setStatus] = useState<RequestStatus>(r.status === 'SUBMITTED' ? 'IN_PROGRESS' : 'RESOLVED');
  const [note, setNote] = useState('');
  const [sendToRepair, setSendToRepair] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [underWarranty, setUnderWarranty] = useState(false);
  const [completedOn, setCompletedOn] = useState(todayBangkok());
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canSendToRepair = status === 'IN_PROGRESS' && !!r.asset && !r.repairOpen && (r.asset.status === 'ACTIVE' || r.asset.status === 'BROKEN');
  const save = useMutation({
    mutationFn: () =>
      api(`/it-requests/${r.id}/status`, {
        method: 'POST',
        body: {
          status,
          note: note || null,
          ...(canSendToRepair && sendToRepair ? { sendToRepair: true, vendorId: vendorId || null, underWarranty } : {}),
          ...(status === 'RESOLVED' && r.repairOpen ? { completedOn, cost: cost === '' ? null : Number(cost) } : {}),
        },
      }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  const label: Record<RequestStatus, string> = {
    SUBMITTED: '',
    IN_PROGRESS: r.status === 'IN_PROGRESS' ? 'อัปเดตความคืบหน้า' : 'รับเรื่อง / กำลังดำเนินการ',
    RESOLVED: 'เสร็จแล้ว',
    REJECTED: 'ไม่อนุมัติ / ทำไม่ได้',
    CANCELLED: '',
  };
  return (
    <Dialog
      wide
      open
      onClose={onClose}
      title={`${requestNo(r.number)} · ${r.title}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant={status === 'REJECTED' ? 'danger' : 'primary'} loading={save.isPending} disabled={(status === 'REJECTED' || (status === r.status && !sendToRepair)) && !note.trim()} onClick={() => save.mutate()}>
            <Check className="h-4 w-4" /> บันทึก
          </Button>
        </>
      }
    >
      <div role="radiogroup" className="grid grid-cols-3 gap-2">
        {next.map((s) => (
          <label key={s} className={`cursor-pointer rounded-lg p-2 text-center text-[13px] font-medium ring-1 ${status === s ? 'bg-brand-50 text-brand-800 ring-brand-500' : 'text-gray-700 ring-gray-200 hover:bg-gray-50'}`}>
            <input type="radio" className="sr-only" checked={status === s} onChange={() => setStatus(s)} />
            {label[s]}
          </label>
        ))}
      </div>
      {canSendToRepair && (
        <div className="space-y-3 rounded-lg bg-amber-50/60 p-3 ring-1 ring-amber-200">
          <label className="flex items-center gap-2 text-[13px] font-medium text-amber-900">
            <input type="checkbox" checked={sendToRepair} onChange={(e) => setSendToRepair(e.target.checked)} />
            <Wrench className="h-4 w-4" /> ส่งเครื่อง {r.asset!.code} ซ่อม (สถานะเครื่องเป็น “ส่งซ่อม” จนกว่าจะปิดงาน)
          </label>
          {sendToRepair && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="ร้าน / ผู้ให้บริการ"><VendorSelect options={options} value={vendorId} onChange={setVendorId} /></Field>
              <label className="mt-7 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={underWarranty} onChange={(e) => setUnderWarranty(e.target.checked)} /> เคลมประกัน</label>
            </div>
          )}
        </div>
      )}
      {status === 'RESOLVED' && r.repairOpen && (
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3">
          <Field label="วันที่รับเครื่องคืนจากซ่อม"><input type="date" className={inputClass} max={todayBangkok()} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} /></Field>
          <Field label="ค่าซ่อม (บาท)"><input type="number" min="0" step="0.01" className={inputClass} value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        </div>
      )}
      <Field label={status === 'REJECTED' ? 'เหตุผล (ผู้ขอจะเห็นข้อความนี้)' : status === 'RESOLVED' ? 'ผลการดำเนินการ (ผู้ขอจะเห็น)' : 'ข้อความถึงผู้ขอ'}>
        <textarea rows={3} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {r.asset && <p className="text-[12px] text-gray-500">ต้องการมอบเครื่องสำรองให้ยืมระหว่างซ่อม → ไปที่หน้าเครื่องสำรองแล้วเลือก “มอบเครื่อง” แบบยืมชั่วคราว</p>}
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

/** "คำขอของฉัน" list with cancel. */
export function MyRequests() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['it-requests', 'mine'], queryFn: () => api<ItRequest[]>('/it-requests/mine') });
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/it-requests/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['it-requests'] }),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Card title="คำขอของฉัน" description="ติดตามสถานะการแจ้งซ่อม / ขอบริการ" bodyClassName="p-4">
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
      {q.isLoading ? (
        <Loading rows={2} />
      ) : !q.data?.length ? (
        <p className="text-[13px] text-gray-500">ยังไม่เคยแจ้ง</p>
      ) : (
        <div className="space-y-3">
          {q.data.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              actions={
                r.status === 'SUBMITTED' ? (
                  <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === r.id} onClick={() => window.confirm('ยกเลิกคำขอนี้?') && cancel.mutate(r.id)}>
                    ยกเลิกคำขอ
                  </Button>
                ) : r.closedAt ? (
                  <span className="text-[11px] text-gray-400">ปิดเมื่อ {thaiDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(r.closedAt)))}{r.handler && ` · ผู้ดูแล ${r.handler}`}</span>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </Card>
  );
}
