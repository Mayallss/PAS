'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { type AssetOptions, personLabel } from '@/lib/assets';

/** Vendor dropdown with inline "add new" (vendors come from receipts, so the list grows as IT works). */
export function VendorSelect({ options, value, onChange, id }: { options: AssetOptions; value: string; onChange: (id: string) => void; id?: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api<{ id: string }>('/assets/vendors', { method: 'POST', body: { name } }),
    onSuccess: async (v) => {
      await qc.invalidateQueries({ queryKey: ['asset-options'] });
      onChange(v.id);
      setAdding(false);
      setName('');
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (adding) {
    return (
      <div className="flex gap-2">
        <input autoFocus className={inputClass} placeholder="ชื่อร้าน / บริษัท" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && add.mutate()} />
        <button type="button" className="shrink-0 rounded-lg bg-brand-600 px-3 text-[13px] font-medium text-white disabled:bg-gray-300" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>เพิ่ม</button>
        <button type="button" className="shrink-0 px-2 text-[13px] text-gray-500" onClick={() => setAdding(false)}>ยกเลิก</button>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— ไม่ระบุ —</option>
        {options.vendors.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>
      <button type="button" aria-label="เพิ่มร้านใหม่" className="shrink-0 rounded-lg px-2 text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50" onClick={() => setAdding(true)}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Location dropdown with inline "add new". */
export function LocationSelect({ options, value, onChange }: { options: AssetOptions; value: string; onChange: (id: string) => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api<{ id: string }>('/assets/locations', { method: 'POST', body: { name } }),
    onSuccess: async (l) => {
      await qc.invalidateQueries({ queryKey: ['asset-options'] });
      onChange(l.id);
      setAdding(false);
      setName('');
    },
  });
  if (adding) {
    return (
      <div className="flex gap-2">
        <input autoFocus className={inputClass} placeholder="เช่น ห้อง Server, โต๊ะ Shell" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="shrink-0 rounded-lg bg-brand-600 px-3 text-[13px] font-medium text-white disabled:bg-gray-300" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>เพิ่ม</button>
        <button type="button" className="shrink-0 px-2 text-[13px] text-gray-500" onClick={() => setAdding(false)}>ยกเลิก</button>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— เลือกสถานที่ —</option>
        {options.locations.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <button type="button" aria-label="เพิ่มสถานที่ใหม่" className="shrink-0 rounded-lg px-2 text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50" onClick={() => setAdding(true)}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Employee dropdown — shows full name, nickname and code because nicknames repeat. */
export function EmployeeSelect({ options, value, onChange, placeholder = '— เลือกพนักงาน —' }: { options: AssetOptions; value: string; onChange: (id: string) => void; placeholder?: string }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.employees.map((e) => (
        <option key={e.id} value={e.id}>{personLabel(e)}</option>
      ))}
    </select>
  );
}
