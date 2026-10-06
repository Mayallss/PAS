'use client';

import { useMutation } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Dialog, Field, inputClass } from '@/components/ui';
import { api, ApiError, apiUpload, errorMessage } from '@/lib/api';
import {
  type AssetDetail,
  type AssetEvent,
  type AssetEventType,
  type AssetOptions,
  type AssetStatus,
  ATTACHMENT_LABEL,
  type AttachmentKind,
  EVENT_LABEL,
  fileSize,
  MANUAL_EVENTS,
  STATUS_META,
} from '@/lib/assets';
import { todayBangkok } from '@/lib/format';
import { EmployeeSelect, LocationSelect, VendorSelect } from './pickers';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,.heic,application/pdf';
const path = (a: AssetDetail) => `/assets/${encodeURIComponent(a.code)}`;

interface Props {
  asset: AssetDetail;
  onClose: () => void;
  onDone: () => void;
}

function Footer({ onClose, loading, disabled, label = 'บันทึก', onSave, danger }: { onClose: () => void; loading: boolean; disabled?: boolean; label?: string; onSave: () => void; danger?: boolean }) {
  return (
    <>
      <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={loading} disabled={disabled} onClick={onSave}>{label}</Button>
    </>
  );
}

// ---------------------------------------------------------------------------

export function AssignDialog({ asset, options, onClose, onDone }: Props & { options: AssetOptions }) {
  const moving = !!asset.holder;
  const [to, setTo] = useState<'employee' | 'location'>('employee');
  const [employeeId, setEmployeeId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [kind, setKind] = useState<'PRIMARY' | 'LOAN' | 'SHARED'>('PRIMARY');
  const [startDate, setStartDate] = useState(todayBangkok());
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Codes the chosen employee already holds (server rule: 1 person = 1 computer). */
  const [holding, setHolding] = useState<string[] | null>(null);
  const [replaceCurrent, setReplaceCurrent] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api(`${path(asset)}/assign`, {
        method: 'POST',
        body: {
          employeeId: to === 'employee' ? employeeId : null,
          locationId: to === 'location' ? locationId : null,
          kind: to === 'location' && kind === 'PRIMARY' ? 'SHARED' : kind,
          startDate,
          dueDate: kind === 'LOAN' ? dueDate : null,
          note: note || null,
          replaceCurrent: to === 'employee' && replaceCurrent,
        },
      }),
    onSuccess: onDone,
    onError: (e) => {
      const held = e instanceof ApiError && e.code === 'ONE_PER_PERSON' ? ((e.details as { holding?: string[] })?.holding ?? null) : null;
      setHolding(held);
      setError(held ? null : errorMessage(e));
    },
  });
  const ready = (to === 'employee' ? !!employeeId : !!locationId) && !!startDate && (kind !== 'LOAN' || !!dueDate) && (!holding || replaceCurrent);
  return (
    <Dialog open onClose={onClose} title={moving ? `ย้ายเครื่อง ${asset.code}` : `มอบเครื่อง ${asset.code}`} footer={<Footer onClose={onClose} loading={save.isPending} disabled={!ready} onSave={() => save.mutate()} label={moving ? 'ย้าย' : 'มอบ'} />}>
      {moving && <Alert tone="info">ปัจจุบัน: {asset.holder!.name} — ระบบจะบันทึกการคืนจากคนเดิมในวันเดียวกันให้อัตโนมัติ</Alert>}
      <div role="tablist" className="inline-flex rounded-lg bg-gray-100 p-1">
        {(['employee', 'location'] as const).map((k) => (
          <button key={k} role="tab" type="button" aria-selected={to === k} onClick={() => { setTo(k); setKind(k === 'location' ? 'SHARED' : 'PRIMARY'); }} className={`h-8 rounded-md px-3 text-[13px] font-medium ${to === k ? 'bg-white shadow-card' : 'text-gray-500'}`}>
            {k === 'employee' ? 'ให้พนักงาน' : 'ไว้ที่สถานที่ (ใช้ร่วม)'}
          </button>
        ))}
      </div>
      {to === 'employee' ? (
        <>
          <Field label="พนักงาน"><EmployeeSelect options={options} value={employeeId} onChange={(id) => { setEmployeeId(id); setHolding(null); setReplaceCurrent(false); }} /></Field>
          <Field label="ลักษณะ">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as 'PRIMARY' | 'LOAN')}>
              <option value="PRIMARY">ใช้ประจำ</option>
              <option value="LOAN">ยืมชั่วคราว (มีวันคืน)</option>
            </select>
          </Field>
        </>
      ) : (
        <Field label="สถานที่"><LocationSelect options={options} value={locationId} onChange={setLocationId} /></Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="ตั้งแต่วันที่"><input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        {kind === 'LOAN' && <Field label="กำหนดคืน"><input type="date" className={inputClass} value={dueDate} min={startDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
      </div>
      <Field label="หมายเหตุ"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ยืมระหว่างส่งเครื่องตัวเองซ่อม" /></Field>
      {holding && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900 ring-1 ring-amber-200">
          <p>พนักงานคนนี้ถือ <span className="font-mono font-medium">{holding.join(', ')}</span> อยู่แล้ว — 1 คนถือคอมพิวเตอร์ได้ 1 เครื่อง</p>
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={replaceCurrent} onChange={(e) => setReplaceCurrent(e.target.checked)} />
            เปลี่ยนเครื่อง: รับ {holding.join(', ')} คืนในวันเดียวกัน
          </label>
          <p className="text-[12px] text-amber-800">ถ้าเป็นการให้ยืมระหว่างเครื่องเดิมส่งซ่อม ให้ส่งเครื่องเดิมซ่อมก่อน แล้วเลือก “ยืมชั่วคราว”</p>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

export function ReturnDialog({ asset, onClose, onDone }: Props) {
  const [date, setDate] = useState(todayBangkok());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api(`${path(asset)}/return`, { method: 'POST', body: { date, note: note || null } }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={`รับคืน ${asset.code}`} footer={<Footer onClose={onClose} loading={save.isPending} disabled={!date} onSave={() => save.mutate()} label="รับคืน" />}>
      <p className="text-[13px] text-gray-600">จาก <span className="font-medium text-gray-900">{asset.holder?.name}</span> — เครื่องจะกลับเป็น “สำรอง”</p>
      <Field label="วันที่รับคืน"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="สภาพเครื่อง / หมายเหตุ"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function FilePicker({ files, setFiles, kind, setKind }: { files: File[]; setFiles: (f: File[]) => void; kind: AttachmentKind; setKind: (k: AttachmentKind) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-white px-2.5 text-[13px] font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50">
          <Paperclip className="h-3.5 w-3.5" /> เลือกไฟล์
          <input type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
        </label>
        <select aria-label="ประเภทไฟล์" className={`${inputClass} h-8 w-auto`} value={kind} onChange={(e) => setKind(e.target.value as AttachmentKind)}>
          {(Object.keys(ATTACHMENT_LABEL) as AttachmentKind[]).map((k) => (
            <option key={k} value={k}>{ATTACHMENT_LABEL[k]}</option>
          ))}
        </select>
        <span className="text-[11px] text-gray-400">รูปภาพ หรือ PDF ไม่เกิน 20 MB</span>
      </div>
      {!!files.length && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2.5 py-1.5 text-[12px]">
              <span className="truncate">{f.name} <span className="text-gray-400">· {fileSize(f.size)}</span></span>
              <button type="button" aria-label={`เอา ${f.name} ออก`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-700"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function uploadAll(asset: AssetDetail, files: File[], kind: AttachmentKind, assetEventId?: string) {
  const failed: string[] = [];
  for (const file of files) {
    const form = new FormData();
    form.append('kind', kind);
    if (assetEventId) form.append('assetEventId', assetEventId);
    form.append('file', file);
    try {
      await apiUpload(`${path(asset)}/attachments`, form);
    } catch (e) {
      failed.push(`${file.name}: ${errorMessage(e)}`);
    }
  }
  return failed;
}

const EVENT_HINT: Partial<Record<AssetEventType, string>> = {
  REPAIR: 'ถ้ายังไม่ได้รับเครื่องคืน เว้นวันที่รับคืนไว้ — เครื่องจะแสดงเป็น “ส่งซ่อม” จนกว่าจะกด “รับเครื่องคืน”',
  UPGRADE: 'แก้ค่าสเปกเฉพาะที่เปลี่ยน ระบบจะเก็บค่าก่อน/หลังไว้ในประวัติ',
  SPEC_CORRECTED: 'ใช้เมื่อสเปกที่บันทึกไว้ผิด (ไม่ใช่การเปลี่ยนชิ้นส่วนจริง)',
};

export function EventDialog({ asset, options, onClose, onDone, initialType = 'REPAIR' }: Props & { options: AssetOptions; initialType?: AssetEventType }) {
  const [type, setType] = useState<AssetEventType>(initialType);
  const [occurredOn, setOccurredOn] = useState(todayBangkok());
  const [completedOn, setCompletedOn] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [cost, setCost] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [underWarranty, setUnderWarranty] = useState(false);
  const [employeeId, setEmployeeId] = useState(asset.holder?.employeeId ?? '');
  const [specs, setSpecs] = useState<Record<string, string>>({ ...asset.specs });
  const [files, setFiles] = useState<File[]>([]);
  const [fileKind, setFileKind] = useState<AttachmentKind>('RECEIPT');
  const [error, setError] = useState<string | null>(null);
  const specEvent = type === 'UPGRADE' || type === 'SPEC_CORRECTED';
  const fields = asset.category.specFields;
  const extraKeys = Object.keys(asset.specs).filter((k) => !fields.some((f) => f.key === k));

  const save = useMutation({
    mutationFn: async () => {
      const changes = specEvent ? Object.fromEntries(Object.entries(specs).filter(([k, v]) => (asset.specs[k] ?? '') !== v).map(([k, v]) => [k, v || null])) : undefined;
      const ev = await api<{ id: string }>(`${path(asset)}/events`, {
        method: 'POST',
        body: {
          type,
          occurredOn,
          completedOn: type === 'REPAIR' && completedOn ? completedOn : null,
          title,
          detail: detail || null,
          specChanges: changes,
          cost: cost ? Number(cost) : null,
          vendorId: vendorId || null,
          underWarranty: type === 'REPAIR' ? underWarranty : null,
          employeeId: employeeId || null,
          expectedVersion: asset.version,
        },
      });
      return uploadAll(asset, files, fileKind, ev.id);
    },
    onSuccess: (failed) => {
      if (failed.length) setError(`บันทึกแล้ว แต่แนบไฟล์ไม่สำเร็จ: ${failed.join(' / ')}`);
      else onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog wide open onClose={onClose} title={`บันทึกประวัติ ${asset.code}`} footer={<Footer onClose={error && save.isSuccess ? onDone : onClose} loading={save.isPending} disabled={!title.trim() || !occurredOn || save.isSuccess} onSave={() => save.mutate()} />}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ประเภท">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as AssetEventType)}>
            {MANUAL_EVENTS.map((t) => (
              <option key={t} value={t}>{EVENT_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <Field label={type === 'REPAIR' ? 'วันที่ส่งซ่อม' : 'วันที่'}><input type="date" className={inputClass} max={todayBangkok()} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} /></Field>
      </div>
      {EVENT_HINT[type] && <p className="text-[12px] text-gray-500">{EVENT_HINT[type]}</p>}
      <Field label="หัวข้อ"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'UPGRADE' ? 'เปลี่ยน HDD เป็น SSD 512GB' : type === 'REPAIR' ? 'จอไม่ติด / เปลี่ยนแบตเตอรี่' : ''} /></Field>
      <Field label="รายละเอียด"><textarea rows={2} className={inputClass} value={detail} onChange={(e) => setDetail(e.target.value)} /></Field>

      {specEvent && (
        <fieldset className="space-y-2 rounded-lg bg-gray-50 p-3">
          <legend className="px-1 text-[12px] font-medium text-gray-600">สเปกหลังเปลี่ยน</legend>
          <div className="grid grid-cols-2 gap-2">
            {[...fields, ...extraKeys.map((k) => ({ key: k, label: k }))].map((f) => {
              const changed = (asset.specs[f.key] ?? '') !== (specs[f.key] ?? '');
              return (
                <Field key={f.key} label={f.label} hint={changed ? `เดิม: ${asset.specs[f.key] || '–'}` : undefined}>
                  <input className={`${inputClass} ${changed ? 'ring-brand-400' : ''}`} value={specs[f.key] ?? ''} onChange={(e) => setSpecs({ ...specs, [f.key]: e.target.value })} />
                </Field>
              );
            })}
          </div>
        </fieldset>
      )}

      {type === 'REPAIR' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="วันที่รับเครื่องคืน" hint="เว้นว่างถ้ายังอยู่ที่ร้าน"><input type="date" className={inputClass} min={occurredOn} max={todayBangkok()} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} /></Field>
          <label className="mt-7 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={underWarranty} onChange={(e) => setUnderWarranty(e.target.checked)} /> เคลมประกัน</label>
        </div>
      )}
      {(type === 'REPAIR' || type === 'UPGRADE' || type === 'SOFTWARE') && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="ค่าใช้จ่าย (บาท)"><input type="number" min="0" step="0.01" className={inputClass} value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          <Field label="ร้าน / ผู้ให้บริการ"><VendorSelect options={options} value={vendorId} onChange={setVendorId} /></Field>
        </div>
      )}
      {(type === 'ISSUE' || type === 'REPAIR') && (
        <Field label="ผู้แจ้ง / ผู้ใช้เครื่อง"><EmployeeSelect options={options} value={employeeId} onChange={setEmployeeId} placeholder="— ไม่ระบุ —" /></Field>
      )}
      <Field label="หลักฐาน (ใบเสร็จ, รูป, ใบเสนอราคา)">
        <FilePicker files={files} setFiles={setFiles} kind={fileKind} setKind={setFileKind} />
      </Field>
      {error && <Alert tone={save.isSuccess ? 'warning' : 'error'}>{error}</Alert>}
    </Dialog>
  );
}

export function CompleteRepairDialog({ asset, event, onClose, onDone }: Props & { event: AssetEvent }) {
  const [completedOn, setCompletedOn] = useState(todayBangkok());
  const [cost, setCost] = useState(event.cost ?? '');
  const [detail, setDetail] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileKind, setFileKind] = useState<AttachmentKind>('RECEIPT');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      await api(`${path(asset)}/events/${event.id}/complete`, {
        method: 'POST',
        body: { completedOn, cost: cost === '' ? null : Number(cost), detail: detail || null, expectedVersion: asset.version },
      });
      return uploadAll(asset, files, fileKind, event.id);
    },
    onSuccess: (failed) => (failed.length ? setError(`บันทึกแล้ว แต่แนบไฟล์ไม่สำเร็จ: ${failed.join(' / ')}`) : onDone()),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onClose={save.isSuccess ? onDone : onClose} title={`รับเครื่องคืนจากซ่อม — ${event.title}`} footer={<Footer onClose={save.isSuccess ? onDone : onClose} loading={save.isPending} disabled={!completedOn || save.isSuccess} onSave={() => save.mutate()} label="ปิดงานซ่อม" />}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="วันที่รับคืน"><input type="date" className={inputClass} min={event.occurredOn} max={todayBangkok()} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} /></Field>
        <Field label="ค่าซ่อม (บาท)"><input type="number" min="0" step="0.01" className={inputClass} value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
      </div>
      <Field label="ผลการซ่อม"><textarea rows={2} className={inputClass} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="เปลี่ยนอะไรไปบ้าง" /></Field>
      <Field label="หลักฐาน"><FilePicker files={files} setFiles={setFiles} kind={fileKind} setKind={setFileKind} /></Field>
      {error && <Alert tone={save.isSuccess ? 'warning' : 'error'}>{error}</Alert>}
    </Dialog>
  );
}

const SETTABLE: AssetStatus[] = ['ACTIVE', 'BROKEN', 'RETIRED', 'LOST', 'DISPOSED'];

export function StatusDialog({ asset, onClose, onDone }: Props) {
  const [status, setStatus] = useState<AssetStatus>(SETTABLE.find((s) => s !== asset.status) ?? 'BROKEN');
  const [occurredOn, setOccurredOn] = useState(todayBangkok());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api(`${path(asset)}/status`, { method: 'POST', body: { status, occurredOn, reason, expectedVersion: asset.version } }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={`เปลี่ยนสถานะ ${asset.code}`} footer={<Footer onClose={onClose} loading={save.isPending} disabled={!reason.trim()} onSave={() => save.mutate()} danger={status === 'DISPOSED'} label={status === 'DISPOSED' ? 'จำหน่าย' : 'บันทึก'} />}>
      <p className="text-[13px] text-gray-600">ปัจจุบัน: <span className="font-medium">{STATUS_META[asset.status].label}</span></p>
      <Field label="สถานะใหม่">
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as AssetStatus)}>
          {SETTABLE.filter((s) => s !== asset.status).map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
      </Field>
      {status === 'DISPOSED' && <Alert tone="warning">จำหน่ายแล้วจะบันทึกประวัติหรือมอบเครื่องต่อไม่ได้อีก (รหัสนี้จะไม่ถูกนำกลับมาใช้)</Alert>}
      <Field label="วันที่"><input type="date" className={inputClass} max={todayBangkok()} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} /></Field>
      <Field label="เหตุผล"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

export function VoidDialog({ title, onClose, onConfirm, pending, error }: { title: string; onClose: () => void; onConfirm: (reason: string) => void; pending: boolean; error: string | null }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open onClose={onClose} title={title} footer={<Footer onClose={onClose} loading={pending} disabled={!reason.trim()} onSave={() => onConfirm(reason)} danger label="ยกเลิกรายการ" />}>
      <p className="text-[13px] text-gray-600">รายการจะยังแสดงในประวัติแบบขีดฆ่าพร้อมเหตุผล (ไม่ลบทิ้ง)</p>
      <Field label="เหตุผล"><input autoFocus className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

export function UploadDialog({ asset, onClose, onDone }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<AttachmentKind>('WARRANTY');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => uploadAll(asset, files, kind),
    onSuccess: (failed) => (failed.length ? setError(failed.join(' / ')) : onDone()),
  });
  return (
    <Dialog open onClose={save.isSuccess ? onDone : onClose} title={`แนบไฟล์ ${asset.code}`} footer={<Footer onClose={save.isSuccess ? onDone : onClose} loading={save.isPending} disabled={!files.length || save.isSuccess} onSave={() => save.mutate()} label="อัปโหลด" />}>
      <p className="text-[13px] text-gray-600">ไฟล์ที่เกี่ยวกับเครื่องโดยรวม เช่น ใบรับประกัน ใบส่งของ — ไฟล์ของการซ่อม/อัปเกรดให้แนบตอนบันทึกรายการนั้น</p>
      <FilePicker files={files} setFiles={setFiles} kind={kind} setKind={setKind} />
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

export function EditInfoDialog({ asset, options, onClose, onDone }: Props & { options: AssetOptions }) {
  const [f, setF] = useState({
    categoryId: asset.category.id,
    brand: asset.brand ?? '',
    model: asset.model ?? '',
    serialNo: asset.serialNo ?? '',
    hostname: asset.hostname ?? '',
    faCode: asset.faCode ?? '',
    purchaseDate: asset.purchaseDate ?? '',
    cost: asset.cost ?? '',
    usefulLifeYears: String(asset.usefulLifeYears),
    warrantyUntil: asset.warrantyUntil ?? '',
    vendorId: asset.vendor?.id ?? '',
    notes: asset.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      api(path(asset), {
        method: 'PATCH',
        body: {
          ...f,
          brand: f.brand || null,
          model: f.model || null,
          serialNo: f.serialNo || null,
          hostname: f.hostname || null,
          faCode: f.faCode || null,
          purchaseDate: f.purchaseDate || null,
          cost: f.cost === '' ? null : Number(f.cost),
          usefulLifeYears: Number(f.usefulLifeYears) || 5,
          warrantyUntil: f.warrantyUntil || null,
          vendorId: f.vendorId || null,
          notes: f.notes || null,
          expectedVersion: asset.version,
        },
      }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog wide open onClose={onClose} title={`แก้ไขข้อมูล ${asset.code}`} footer={<Footer onClose={onClose} loading={save.isPending} onSave={() => save.mutate()} />}>
      <p className="text-[12px] text-gray-500">สเปกไม่ได้แก้ที่นี่ — ใช้ “บันทึกประวัติ” → อัปเกรด หรือ แก้สเปกที่บันทึกผิด</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ประเภท">
          <select className={inputClass} value={f.categoryId} onChange={set('categoryId')}>
            {options.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="ยี่ห้อ"><input className={inputClass} value={f.brand} onChange={set('brand')} /></Field>
        <Field label="รุ่น"><input className={inputClass} value={f.model} onChange={set('model')} /></Field>
        <Field label="Serial Number"><input className={inputClass} value={f.serialNo} onChange={set('serialNo')} /></Field>
        <Field label="ชื่อเครื่อง (Windows)"><input className={inputClass} value={f.hostname} onChange={set('hostname')} /></Field>
        <Field label="รหัส FA"><input className={inputClass} value={f.faCode} onChange={set('faCode')} /></Field>
        <Field label="วันที่เริ่มใช้งาน"><input type="date" className={inputClass} value={f.purchaseDate} onChange={set('purchaseDate')} /></Field>
        <Field label="ราคาทุน"><input type="number" min="0" step="0.01" className={inputClass} value={f.cost} onChange={set('cost')} /></Field>
        <Field label="อายุการใช้งาน (ปี)"><input type="number" min="1" max="50" className={inputClass} value={f.usefulLifeYears} onChange={set('usefulLifeYears')} /></Field>
        <Field label="ประกันถึง"><input type="date" className={inputClass} value={f.warrantyUntil} onChange={set('warrantyUntil')} /></Field>
      </div>
      <Field label="ผู้จัดจำหน่าย"><VendorSelect options={options} value={f.vendorId} onChange={(vendorId) => setF({ ...f, vendorId })} /></Field>
      <Field label="หมายเหตุ"><textarea rows={2} className={inputClass} value={f.notes} onChange={set('notes')} /></Field>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}
