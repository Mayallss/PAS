'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Alert, Button, Dialog, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { AssetOptions, AssetRow, AssetSummary } from '@/lib/assets';
import { addDays } from '@/lib/format';
import { type LicenseDetail, type LicenseMetric, type LicenseRow, type LicenseType, METRIC_LABEL, SOFTWARE_CATEGORIES, type SoftwareRow, TYPE_LABEL } from '@/lib/licenses';

const opt = (s: string) => (s.trim() === '' ? null : s.trim());
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

// ---------------------------------------------------------------------------
// Software
// ---------------------------------------------------------------------------

export function SoftwareForm({ software, onClose, onSaved }: { software?: SoftwareRow; onClose: () => void; onSaved: (s: { id: string }) => void }) {
  const [f, setF] = useState({
    name: software?.name ?? '',
    publisher: software?.publisher ?? '',
    category: software?.category ?? '',
    website: software?.website ?? '',
    notes: software?.notes ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      api<{ id: string }>(software ? `/software/${software.id}` : '/software', {
        method: software ? 'PATCH' : 'POST',
        body: { name: f.name.trim(), publisher: opt(f.publisher), category: opt(f.category), website: opt(f.website), notes: opt(f.notes) },
      }),
    onSuccess: onSaved,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={software ? `แก้ไข ${software.name}` : 'เพิ่มซอฟต์แวร์'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>บันทึก</Button>
        </>
      }
    >
      <Field label="ชื่อซอฟต์แวร์">
        <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="เช่น ESET Smart Security Premium, Microsoft Office 2021" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ผู้ผลิต">
          <input className={inputClass} value={f.publisher} onChange={(e) => setF({ ...f, publisher: e.target.value })} />
        </Field>
        <Field label="หมวด" hint="พิมพ์เองได้ — “แอนตี้ไวรัส” ใช้ตรวจเครื่องที่ยังไม่มีแอนตี้ไวรัส">
          <input className={inputClass} list="software-categories" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          <datalist id="software-categories">
            {SOFTWARE_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="เว็บไซต์ / พอร์ทัลจัดการ">
        <input className={inputClass} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      </Field>
      <Field label="หมายเหตุ">
        <textarea className={`${inputClass} min-h-16 py-2`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      {save.error && <Alert tone="error">{errorMessage(save.error)}</Alert>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Licence (create / edit)
// ---------------------------------------------------------------------------

export function LicenseForm({ license, software, onClose, onSaved, onNewSoftware }: {
  license?: LicenseRow;
  software: SoftwareRow[];
  onClose: () => void;
  onSaved: (id: string) => void;
  onNewSoftware: () => void;
}) {
  const options = useQuery({ queryKey: ['asset-options'], queryFn: () => api<AssetOptions>('/assets/options') });
  const [f, setF] = useState({
    softwareId: license?.software.id ?? software.find((s) => s.isActive)?.id ?? '',
    name: license?.name ?? '',
    edition: license?.edition ?? '',
    type: (license?.type ?? 'SUBSCRIPTION') as LicenseType,
    metric: (license?.metric ?? 'PER_DEVICE') as LicenseMetric,
    seats: license?.seats != null ? String(license.seats) : '',
    startDate: license?.startDate ?? '',
    endDate: license?.endDate ?? '',
    autoRenew: license?.autoRenew ?? false,
    cost: license?.cost != null ? String(license.cost) : '',
    vendorId: license?.vendor?.id ?? '',
    reference: license?.reference ?? '',
    keyHint: license?.keyHint ?? '',
    notes: license?.notes ?? '',
  });
  const [attrs, setAttrs] = useState<[string, string][]>(Object.entries(license?.attributes ?? {}));
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const endRequired = f.type === 'SUBSCRIPTION';

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        edition: opt(f.edition),
        type: f.type,
        metric: f.metric,
        seats: numOrNull(f.seats),
        startDate: opt(f.startDate),
        endDate: opt(f.endDate),
        autoRenew: f.autoRenew,
        cost: numOrNull(f.cost),
        vendorId: f.vendorId || null,
        reference: opt(f.reference),
        keyHint: opt(f.keyHint),
        attributes: Object.fromEntries(attrs.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])),
        notes: opt(f.notes),
      };
      return license
        ? api<{ id: string }>(`/licenses/${license.id}`, { method: 'PATCH', body: { ...body, expectedVersion: license.version } })
        : api<{ id: string }>('/licenses', { method: 'POST', body: { ...body, softwareId: f.softwareId } });
    },
    onSuccess: (r) => onSaved(r.id),
  });

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={license ? `แก้ไขไลเซนส์ ${license.name}` : 'เพิ่มไลเซนส์'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.softwareId || !f.name.trim() || (endRequired && !f.endDate)} onClick={() => save.mutate()}>
            บันทึก
          </Button>
        </>
      }
    >
      {!license && (
        <Field label="ซอฟต์แวร์">
          <div className="flex gap-2">
            <select className={inputClass} value={f.softwareId} onChange={(e) => set({ softwareId: e.target.value })}>
              <option value="">— เลือก —</option>
              {software.filter((s) => s.isActive).map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.category ? ` · ${s.category}` : ''}</option>
              ))}
            </select>
            <Button type="button" variant="secondary" onClick={onNewSoftware}>
              <Plus className="h-4 w-4" /> ใหม่
            </Button>
          </div>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="ชื่อไลเซนส์" hint="เช่น ESET 2026–2027 Lot 1">
          <input className={inputClass} value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="รุ่น / Edition">
          <input className={inputClass} value={f.edition} onChange={(e) => set({ edition: e.target.value })} />
        </Field>
        <Field label="ประเภท">
          <select className={inputClass} value={f.type} onChange={(e) => set({ type: e.target.value as LicenseType })}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="นับสิทธิ์">
          <select className={inputClass} value={f.metric} onChange={(e) => set({ metric: e.target.value as LicenseMetric })}>
            {Object.entries(METRIC_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="จำนวนสิทธิ์" hint="เว้นว่าง = ไม่จำกัด">
          <input className={inputClass} inputMode="numeric" value={f.seats} onChange={(e) => set({ seats: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="ราคา (บาท)">
          <input className={inputClass} inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: e.target.value.replace(/[^\d.]/g, '') })} />
        </Field>
        <Field label="เริ่มใช้">
          <input type="date" className={inputClass} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label={endRequired ? 'หมดอายุ' : 'หมดอายุ (ถ้ามี)'}>
          <input type="date" className={inputClass} value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} />
        </Field>
        <Field label="ผู้จำหน่าย">
          <select className={inputClass} value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
            <option value="">—</option>
            {options.data?.vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </Field>
        <Field label="เลขอ้างอิง / Lot / PO">
          <input className={inputClass} value={f.reference} onChange={(e) => set({ reference: e.target.value })} />
        </Field>
        <Field label="ท้ายคีย์ (ไม่เกิน 8 ตัว)" hint="ห้ามใส่คีย์เต็ม — ระบุที่เก็บคีย์ในหมายเหตุ">
          <input className={`${inputClass} font-mono`} maxLength={12} value={f.keyHint} onChange={(e) => set({ keyHint: e.target.value })} placeholder="เช่น …X7K2" />
        </Field>
        <label className="mt-6 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={f.autoRenew} onChange={(e) => set({ autoRenew: e.target.checked })} /> ต่ออายุอัตโนมัติ
        </label>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-gray-700">ข้อมูลเพิ่มเติม (กำหนดเองได้)</legend>
        <div className="space-y-2">
          {attrs.map(([k, v], i) => (
            <div key={i} className="flex gap-2">
              <input aria-label="ชื่อช่อง" className={`${inputClass} w-40`} placeholder="เช่น บัญชีพอร์ทัล" value={k} onChange={(e) => setAttrs(attrs.map((a, j) => (j === i ? [e.target.value, a[1]] : a)))} />
              <input aria-label="ค่า" className={inputClass} value={v} onChange={(e) => setAttrs(attrs.map((a, j) => (j === i ? [a[0], e.target.value] : a)))} />
              <button type="button" aria-label="ลบช่องนี้" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => setAttrs([...attrs, ['', '']])}>
            <Plus className="h-3.5 w-3.5" /> เพิ่มช่อง
          </Button>
        </div>
      </fieldset>
      <Field label="หมายเหตุ">
        <textarea className={`${inputClass} min-h-16 py-2`} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      {save.error && <Alert tone="error">{errorMessage(save.error)}</Alert>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Renew
// ---------------------------------------------------------------------------

export function RenewForm({ license, onClose, onSaved }: { license: LicenseDetail; onClose: () => void; onSaved: (id: string) => void }) {
  const start = license.endDate ? addDays(license.endDate, 1) : '';
  const [f, setF] = useState({
    name: license.name.replace(/(\d{4})\s*[–-]\s*(\d{4})/, (_, a: string, b: string) => `${Number(a) + 1}–${Number(b) + 1}`),
    startDate: start,
    endDate: start ? `${Number(start.slice(0, 4)) + 1}${start.slice(4)}` : '',
    seats: license.seats != null ? String(license.seats) : '',
    cost: '',
    autoRenew: license.autoRenew,
    reference: license.reference ?? '',
    carrySeats: true,
  });
  const active = license.seatsList.filter((s) => !s.endDate).length;
  const save = useMutation({
    mutationFn: () =>
      api<{ id: string; moved: number }>(`/licenses/${license.id}/renew`, {
        method: 'POST',
        body: {
          name: f.name.trim(),
          startDate: f.startDate,
          endDate: opt(f.endDate),
          seats: numOrNull(f.seats),
          cost: numOrNull(f.cost),
          autoRenew: f.autoRenew,
          reference: opt(f.reference),
          carrySeats: f.carrySeats,
        },
      }),
    onSuccess: (r) => onSaved(r.id),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`ต่ออายุ ${license.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !f.startDate} onClick={() => save.mutate()}>สร้างไลเซนส์ปีใหม่</Button>
        </>
      }
    >
      <p className="-mt-1 text-[13px] text-gray-500">สร้างเป็นไลเซนส์ใหม่ที่ผูกกับของเดิม — ประวัติของปีเดิมยังอยู่ครบ</p>
      <Field label="ชื่อไลเซนส์ใหม่">
        <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="เริ่ม">
          <input type="date" className={inputClass} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </Field>
        <Field label="หมดอายุ">
          <input type="date" className={inputClass} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        </Field>
        <Field label="จำนวนสิทธิ์" hint="เว้นว่าง = ไม่จำกัด">
          <input className={inputClass} inputMode="numeric" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="ราคา (บาท)">
          <input className={inputClass} inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/[^\d.]/g, '') })} />
        </Field>
        <Field label="เลขอ้างอิง / Lot">
          <input className={inputClass} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
        <label className="mt-6 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} /> ต่ออายุอัตโนมัติ
        </label>
      </div>
      <label className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-[13px]">
        <input type="checkbox" className="mt-0.5" checked={f.carrySeats} onChange={(e) => setF({ ...f, carrySeats: e.target.checked })} />
        <span>
          ย้าย {active} เครื่องที่ใช้อยู่ไปไลเซนส์ใหม่ <span className="text-gray-500">(สิทธิ์เดิมปิดวันก่อนเริ่มปีใหม่ — ถ้าบางเครื่องไม่ต่อ ปลดออกทีหลังได้)</span>
        </span>
      </label>
      {save.error && <Alert tone="error">{errorMessage(save.error)}</Alert>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add machines
// ---------------------------------------------------------------------------

export function AddSeats({ license, onClose, onSaved }: { license: LicenseDetail; onClose: () => void; onSaved: (added: number) => void }) {
  const [q, setQ] = useState('');
  const search = useDeferredValue(q);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [installedOn, setInstalledOn] = useState('');
  const [note, setNote] = useState('');
  const list = useQuery({
    queryKey: ['assets', search, '', ''],
    queryFn: () => api<{ summary: AssetSummary; rows: AssetRow[] }>('/assets', { query: { q: search } }),
    placeholderData: (p) => p,
  });
  const taken = new Set(license.seatsList.filter((s) => !s.endDate && s.asset).map((s) => s.asset!.code));
  const rows = (list.data?.rows ?? []).filter((a) => !taken.has(a.code) && a.status !== 'DISPOSED' && a.status !== 'LOST');
  const free = license.seats === null ? null : license.seats - license.used;
  const over = free !== null && picked.size > free;

  const save = useMutation({
    mutationFn: () =>
      api<{ added: number }>(`/licenses/${license.id}/seats`, {
        method: 'POST',
        body: { assetCodes: [...picked], installedOn: installedOn || null, note: opt(note) },
      }),
    onSuccess: (r) => onSaved(r.added),
  });

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`เพิ่มเครื่องใน ${license.name}`}
      footer={
        <>
          <span className={`mr-auto text-[13px] ${over ? 'text-rose-600' : 'text-gray-500'}`}>
            เลือก {picked.size} เครื่อง{free !== null && ` · เหลือสิทธิ์ ${free}`}
          </span>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!picked.size || over} onClick={() => save.mutate()}>เพิ่ม</Button>
        </>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input className={`${inputClass} pl-9`} placeholder="ค้นหารหัสเครื่อง ยี่ห้อ รุ่น" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg ring-1 ring-gray-200">
        {rows.map((a) => (
          <li key={a.code}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
              <input
                type="checkbox"
                checked={picked.has(a.code)}
                onChange={(e) =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(a.code);
                    else n.delete(a.code);
                    return n;
                  })
                }
              />
              <span className="w-24 font-mono text-[13px] text-gray-900">{a.code}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-gray-600">
                {a.category.name} · {[a.brand, a.model].filter(Boolean).join(' ') || '–'}
              </span>
            </label>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-gray-500">ไม่พบเครื่องที่ยังไม่มีสิทธิ์นี้</li>}
      </ul>
      <div className="grid grid-cols-2 gap-3">
        <Field label="วันที่ติดตั้ง (ถ้าติดตั้งแล้ว)">
          <input type="date" className={inputClass} value={installedOn} onChange={(e) => setInstalledOn(e.target.value)} />
        </Field>
        <Field label="หมายเหตุ">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {save.error && <Alert tone="error">{errorMessage(save.error)}</Alert>}
    </Dialog>
  );
}
