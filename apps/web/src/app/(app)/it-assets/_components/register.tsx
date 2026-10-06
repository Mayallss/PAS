'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Laptop, MessageSquareWarning, Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Alert, Badge, Card, Empty, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { ASSET_STATES, type AssetOptions, type AssetRow, type AssetState, type AssetSummary, KIND_LABEL, STATE_META } from '@/lib/assets';
import { thaiDateShort } from '@/lib/format';

const TILES: AssetState[] = ['IN_USE', 'AVAILABLE', 'IN_REPAIR', 'BROKEN', 'RETIRED'];

/** IT/Admin register: every device with its state, holder and latest history entry. */
export function Register() {
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [state, setState] = useState<AssetState | ''>('');
  const [agedOnly, setAgedOnly] = useState(false);
  const search = useDeferredValue(q);

  const options = useQuery({ queryKey: ['asset-options'], queryFn: () => api<AssetOptions>('/assets/options') });
  const list = useQuery({
    queryKey: ['assets', search, categoryId, state],
    queryFn: () => api<{ summary: AssetSummary; rows: AssetRow[] }>('/assets', { query: { q: search, categoryId, state } }),
    placeholderData: (prev) => prev,
  });
  const s = list.data?.summary;
  const rows = (list.data?.rows ?? []).filter((a) => !agedOnly || a.pastUsefulLife);
  const pick = (next: AssetState | '') => {
    setAgedOnly(false);
    setState(next);
  };

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Tile label="ทั้งหมด" value={s?.total} active={!state && !agedOnly} onClick={() => pick('')} />
        {TILES.map((st) => (
          <Tile key={st} label={STATE_META[st].label} hint={STATE_META[st].hint} value={s?.byState[st]} active={state === st} tone={STATE_META[st].tone} onClick={() => pick(st)} />
        ))}
        <Tile label="เกินอายุใช้งาน" value={s?.pastUsefulLife} active={agedOnly} onClick={() => { setState(''); setAgedOnly(true); }} />
      </div>
      {!!s?.overdueLoans && (
        <div className="mb-4">
          <Alert tone="warning">
            <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> มีเครื่องยืมที่เกินกำหนดคืน {s.overdueLoans} เครื่อง</span>
          </Alert>
        </div>
      )}

      <Card
        bodyClassName="p-0"
        title="อุปกรณ์"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
              <input aria-label="ค้นหา" placeholder="รหัส / รุ่น / Serial / ผู้ถือ" className={`${inputClass} w-60 pl-8`} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select aria-label="ประเภท" className={`${inputClass} w-44`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">ทุกประเภท</option>
              {options.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select aria-label="สถานะ" className={`${inputClass} w-40`} value={state} onChange={(e) => pick(e.target.value as AssetState | '')}>
              <option value="">ทุกสถานะ</option>
              {ASSET_STATES.map((st) => <option key={st} value={st}>{STATE_META[st].label}</option>)}
            </select>
          </>
        }
      >
        {list.isLoading ? (
          <div className="p-5"><Loading rows={6} /></div>
        ) : list.error ? (
          <div className="p-5"><Alert tone="error">{errorMessage(list.error)}</Alert></div>
        ) : !rows.length ? (
          <Empty icon={<Laptop className="h-5 w-5" />} title="ไม่พบอุปกรณ์">
            {q || categoryId || state || agedOnly ? 'ลองเปลี่ยนตัวกรอง' : 'เริ่มจากลงทะเบียนเครื่องแรก หรือนำเข้าจาก Sheet สำรวจอุปกรณ์'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className="border-b border-gray-200 text-left text-[12px] text-gray-500">
                <tr>
                  <th className="px-5 py-2 font-medium">รหัส</th>
                  <th className="px-3 py-2 font-medium">รุ่น / สเปก</th>
                  <th className="px-3 py-2 font-medium">ผู้ถือ</th>
                  <th className="px-3 py-2 font-medium">สถานะ</th>
                  <th className="px-3 py-2 font-medium">อายุ</th>
                  <th className="px-3 py-2 font-medium">ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                    <td className="px-5 py-2.5">
                      <Link href={`/it-assets/${encodeURIComponent(a.code)}`} className="font-mono font-medium text-brand-700 hover:underline">{a.code}</Link>
                      <p className="text-[11px] text-gray-400">{a.category.name}</p>
                    </td>
                    <td className="max-w-72 px-3 py-2.5">
                      <p className="truncate text-gray-900">{[a.brand, a.model].filter(Boolean).join(' ') || '–'}</p>
                      <p className="truncate text-[11px] text-gray-500">{[a.specs.cpu, a.specs.ram, a.specs.storage].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      {a.holder ? (
                        <>
                          <p className="text-gray-900">{a.holder.name}</p>
                          <p className="text-[11px] text-gray-500">
                            {KIND_LABEL[a.holder.kind]}
                            {a.holder.dueDate && <span className={a.holder.overdue ? 'font-medium text-rose-600' : ''}> · คืน {thaiDateShort(a.holder.dueDate)}</span>}
                          </p>
                        </>
                      ) : (
                        <span className="text-gray-400">–</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={STATE_META[a.state].tone}>{STATE_META[a.state].label}</Badge>
                        {a.openRequests > 0 && <Badge tone="rose"><MessageSquareWarning className="h-3 w-3" /> คำขอ {a.openRequests}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {a.ageYears === null ? <span className="text-gray-400">–</span> : <span className={a.pastUsefulLife ? 'font-medium text-amber-700' : 'text-gray-600'}>{a.ageYears} ปี</span>}
                    </td>
                    <td className="max-w-64 px-3 py-2.5 text-gray-500">
                      {a.lastEvent && (
                        <>
                          <p className="truncate">{a.lastEvent.title}</p>
                          <p className="text-[11px]">{thaiDateShort(a.lastEvent.occurredOn)}</p>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value, onClick, active, tone, hint }: { label: string; value: number | undefined; onClick: () => void; active: boolean; tone?: string; hint?: string }) {
  const color = { brand: 'text-brand-700', sky: 'text-sky-700', amber: 'text-amber-700', rose: 'text-rose-700', gray: 'text-gray-600' }[tone ?? ''] ?? 'text-gray-900';
  return (
    <button type="button" onClick={onClick} title={hint} aria-pressed={active} className={`rounded-xl bg-white p-3.5 text-left shadow-card ring-1 transition ${active ? 'ring-2 ring-brand-500' : 'ring-gray-200/80 hover:ring-brand-200'}`}>
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value ?? '–'}</p>
    </button>
  );
}
