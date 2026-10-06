'use client';

import { useMutation } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Dialog, Field, inputClass } from '@/components/ui';
import { api, apiUpload, errorMessage } from '@/lib/api';
import { fileSize, type ItRequest, REQUEST_TYPE_HINT, REQUEST_TYPE_LABEL, type RequestType, type Urgency } from '@/lib/assets';

const TYPES = Object.keys(REQUEST_TYPE_LABEL) as RequestType[];
const NEEDS_DEVICE: RequestType[] = ['REPAIR', 'REPLACEMENT', 'UPGRADE'];

/**
 * แจ้งซ่อม / ขอบริการ. `devices` are the machines the person holds; for REPAIR/REPLACEMENT/UPGRADE one must
 * be chosen (it is pre-selected when there is only one — 1 person = 1 computer).
 */
export function RequestDialog({
  devices,
  initialType = 'REPAIR',
  fixedAssetCode,
  onClose,
  onDone,
}: {
  devices: { code: string; label: string }[];
  initialType?: RequestType;
  fixedAssetCode?: string;
  onClose: () => void;
  onDone: (r: ItRequest) => void;
}) {
  const [type, setType] = useState<RequestType>(initialType);
  const [assetCode, setAssetCode] = useState(fixedAssetCode ?? (devices.length === 1 ? devices[0].code : ''));
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('NORMAL');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ItRequest | null>(null);
  const needsDevice = NEEDS_DEVICE.includes(type);

  const save = useMutation({
    mutationFn: async () => {
      const r =
        created ??
        (await api<ItRequest>('/it-requests', {
          method: 'POST',
          body: { type, assetCode: assetCode || null, title, detail: detail || null, urgency },
        }));
      setCreated(r);
      const failed: string[] = [];
      for (const f of files) {
        const form = new FormData();
        form.append('file', f);
        try {
          await apiUpload(`/it-requests/${r.id}/attachments`, form);
        } catch (e) {
          failed.push(`${f.name}: ${errorMessage(e)}`);
        }
      }
      return { r, failed };
    },
    onSuccess: ({ r, failed }) => (failed.length ? setError(`ส่งคำขอแล้ว แต่แนบรูปไม่สำเร็จ: ${failed.join(' / ')}`) : onDone(r)),
    onError: (e) => setError(errorMessage(e)),
  });

  const ready = title.trim() && (!needsDevice || assetCode || devices.length === 0);
  return (
    <Dialog
      wide
      open
      onClose={created ? () => onDone(created) : onClose}
      title="แจ้งซ่อม / ขอบริการ IT"
      footer={
        created && error ? (
          <Button variant="primary" onClick={() => onDone(created)}>ปิด</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
            <Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => { setError(null); save.mutate(); }}>ส่งคำขอ</Button>
          </>
        )
      }
    >
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-gray-700">เรื่อง</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TYPES.map((t) => (
            <label key={t} className={`cursor-pointer rounded-lg p-2.5 ring-1 transition ${type === t ? 'bg-brand-50 ring-brand-500' : 'ring-gray-200 hover:bg-gray-50'}`}>
              <input type="radio" name="type" className="sr-only" checked={type === t} onChange={() => setType(t)} />
              <span className="block text-[13px] font-medium text-gray-900">{REQUEST_TYPE_LABEL[t]}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{REQUEST_TYPE_HINT[t]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {!fixedAssetCode && (needsDevice || devices.length > 0) && (
        <Field label={needsDevice ? 'เครื่อง' : 'เครื่องที่เกี่ยวข้อง (ถ้ามี)'}>
          {devices.length ? (
            <select className={inputClass} value={assetCode} onChange={(e) => setAssetCode(e.target.value)}>
              {!needsDevice || devices.length > 1 ? <option value="">{needsDevice ? '— เลือกเครื่อง —' : '— ไม่ระบุ —'}</option> : null}
              {devices.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
            </select>
          ) : (
            <p className="rounded-md bg-amber-50 px-2.5 py-2 text-[12px] text-amber-800">ยังไม่มีเครื่องลงทะเบียนในชื่อคุณ — IT จะตรวจสอบให้ (หรือเลือกเรื่อง “อื่น ๆ”)</p>
          )}
        </Field>
      )}

      <Field label="หัวข้อ"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'REPAIR' ? 'เช่น เปิดไม่ติด, จอกระพริบ, แบตหมดเร็ว' : ''} /></Field>
      <Field label="รายละเอียด"><textarea rows={3} className={inputClass} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="อาการ เริ่มเป็นเมื่อไร ทำอะไรแล้วเกิดปัญหา" /></Field>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={urgency === 'URGENT'} onChange={(e) => setUrgency(e.target.checked ? 'URGENT' : 'NORMAL')} />
          ด่วน — ทำงานต่อไม่ได้
        </label>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-white px-2.5 text-[13px] font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50">
          <Paperclip className="h-3.5 w-3.5" /> แนบรูป
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,.heic,application/pdf" className="sr-only" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
        </label>
      </div>
      {!!files.length && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between rounded-md bg-gray-50 px-2.5 py-1.5 text-[12px]">
              <span className="truncate">{f.name} · {fileSize(f.size)}</span>
              <button type="button" aria-label={`เอา ${f.name} ออก`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-700"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {error && <Alert tone={created ? 'warning' : 'error'}>{error}</Alert>}
    </Dialog>
  );
}
