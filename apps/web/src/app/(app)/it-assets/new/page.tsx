'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Field, inputClass, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { AssetOptions } from '@/lib/assets';
import { VendorSelect } from '../_components/pickers';

export default function NewAssetPage() {
  const router = useRouter();
  const options = useQuery({ queryKey: ['asset-options'], queryFn: () => api<AssetOptions>('/assets/options') });
  const [categoryId, setCategoryId] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [f, setF] = useState({ brand: '', model: '', serialNo: '', hostname: '', faCode: '', purchaseDate: '', cost: '', usefulLifeYears: '5', warrantyUntil: '', vendorId: '', notes: '' });
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!categoryId && options.data?.categories[0]) setCategoryId(options.data.categories[0].id);
  }, [categoryId, options.data]);

  // Suggest the next free code for the category (legacy codes can still be typed over it).
  const next = useQuery({
    queryKey: ['asset-next-code', categoryId],
    queryFn: () => api<{ code: string }>('/assets/next-code', { query: { categoryId } }),
    enabled: !!categoryId,
  });
  useEffect(() => {
    if (next.data && !codeTouched) setCode(next.data.code);
  }, [next.data, codeTouched]);

  const category = options.data?.categories.find((c) => c.id === categoryId);

  const save = useMutation({
    mutationFn: () =>
      api<{ code: string }>('/assets', {
        method: 'POST',
        body: {
          code,
          categoryId,
          brand: f.brand || null,
          model: f.model || null,
          serialNo: f.serialNo || null,
          hostname: f.hostname || null,
          faCode: f.faCode || null,
          purchaseDate: f.purchaseDate || null,
          cost: f.cost ? Number(f.cost) : null,
          usefulLifeYears: Number(f.usefulLifeYears) || 5,
          warrantyUntil: f.warrantyUntil || null,
          vendorId: f.vendorId || null,
          notes: f.notes || null,
          specs: Object.fromEntries((category?.specFields ?? []).map((s) => [s.key, specs[s.key] || null])),
        },
      }),
    onSuccess: (a) => router.push(`/it-assets/${encodeURIComponent(a.code)}`),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!options.data) return <Loading rows={6} />;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/it-assets" className="mb-3 inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> IT Asset
      </Link>
      <PageHeader title="ลงทะเบียนอุปกรณ์" description="หลังบันทึกแล้วจะไปหน้าเครื่อง เพื่อมอบให้ผู้ใช้และแนบใบเสร็จ/ใบรับประกัน" />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Card title="ข้อมูลเครื่อง">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ประเภท">
              <select className={inputClass} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSpecs({}); }}>
                {options.data.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="รหัสอุปกรณ์" hint="ระบบเสนอรหัสถัดไป — เครื่องเดิมใส่รหัสเดิมได้ เช่น CEO-0001, OE348">
              <input className={`${inputClass} font-mono uppercase`} required value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeTouched(true); }} />
            </Field>
            <Field label="ยี่ห้อ"><input className={inputClass} value={f.brand} onChange={set('brand')} placeholder="ASUS, LENOVO" /></Field>
            <Field label="รุ่น"><input className={inputClass} value={f.model} onChange={set('model')} placeholder="IdeaPad Slim 3 14IRH10" /></Field>
            <Field label="Serial Number"><input className={inputClass} value={f.serialNo} onChange={set('serialNo')} /></Field>
            <Field label="ชื่อเครื่อง (Windows)" hint="ใช้จับคู่กับรายการแอนตี้ไวรัส"><input className={inputClass} value={f.hostname} onChange={set('hostname')} placeholder="LAPTOP-CEO-01" /></Field>
          </div>
        </Card>

        {!!category?.specFields.length && (
          <Card title="สเปก" description="สเปกที่เปลี่ยนภายหลังให้บันทึกผ่าน “อัปเกรด” ในหน้าเครื่อง เพื่อเก็บประวัติ">
            <div className="grid gap-4 sm:grid-cols-2">
              {category.specFields.map((s) => (
                <Field key={s.key} label={s.label}>
                  <input className={inputClass} value={specs[s.key] ?? ''} onChange={(e) => setSpecs({ ...specs, [s.key]: e.target.value })} />
                </Field>
              ))}
            </div>
          </Card>
        )}

        <Card title="การซื้อ">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="วันที่เริ่มใช้งาน / ซื้อ"><input type="date" className={inputClass} value={f.purchaseDate} onChange={set('purchaseDate')} /></Field>
            <Field label="ราคาทุน (บาท)"><input type="number" min="0" step="0.01" className={inputClass} value={f.cost} onChange={set('cost')} /></Field>
            <Field label="อายุการใช้งาน (ปี)"><input type="number" min="1" max="50" className={inputClass} value={f.usefulLifeYears} onChange={set('usefulLifeYears')} /></Field>
            <Field label="ประกันถึงวันที่"><input type="date" className={inputClass} value={f.warrantyUntil} onChange={set('warrantyUntil')} /></Field>
            <Field label="ผู้จัดจำหน่าย">
              <VendorSelect options={options.data} value={f.vendorId} onChange={(vendorId) => setF({ ...f, vendorId })} />
            </Field>
            <Field label="รหัสในทะเบียนสินทรัพย์ (FA)" hint="กรอกเมื่อไม่ตรงกับรหัสอุปกรณ์"><input className={inputClass} value={f.faCode} onChange={set('faCode')} /></Field>
          </div>
          <div className="mt-4">
            <Field label="หมายเหตุ"><textarea rows={2} className={inputClass} value={f.notes} onChange={set('notes')} /></Field>
          </div>
        </Card>

        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Link href="/it-assets" className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm text-gray-600 hover:bg-gray-100">ยกเลิก</Link>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!code || !categoryId}>บันทึก</Button>
        </div>
      </form>
    </div>
  );
}
