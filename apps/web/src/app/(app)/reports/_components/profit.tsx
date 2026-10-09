'use client';

/**
 * กำไร–ขาดทุนตามลูกค้า: revenue (imported) − cost of time, one diverging bar per customer around zero.
 * Polarity colours: brand indigo = profit, red = loss (pair validated ≥ 22 ΔE under CVD); the sign and the word
 * "ขาดทุน" travel with every value, so colour never carries the meaning alone. Every number is printed.
 */

import { AlertTriangle, ChevronDown, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Card } from '@/components/ui';
import { baht, bahtRound, hoursText, type ProfitRow } from './explorer-data';

type Sort = 'profit' | 'loss' | 'revenue' | 'margin';
const SORTS: [Sort, string][] = [
  ['profit', 'กำไรมากสุด'],
  ['loss', 'ขาดทุนมากสุด'],
  ['revenue', 'รายได้มากสุด'],
  ['margin', 'Margin ต่ำสุด'],
];
const TOP = 10;
const pct = (m: number | null) => (m === null ? '–' : `${Math.round(m * 1000) / 10}%`);
const signed = (n: number) => `${n < 0 ? '−' : '+'}฿${bahtRound(Math.abs(n))}`;

export function ProfitCard({
  list,
  unmatched,
  selected,
  onPick,
  canImport,
  noRevenueYet,
}: {
  list: ProfitRow[];
  unmatched: number;
  selected?: string;
  onPick: (customerId: string) => void;
  canImport: boolean;
  noRevenueYet: boolean;
}) {
  const [sort, setSort] = useState<Sort>('profit');
  const [all, setAll] = useState(false);
  const sorted = [...list].sort((a, b) =>
    sort === 'profit' ? b.profit - a.profit : sort === 'loss' ? a.profit - b.profit : sort === 'revenue' ? b.revenue - a.revenue : (a.margin ?? -Infinity) - (b.margin ?? -Infinity),
  );
  const shown = all ? sorted : sorted.slice(0, TOP);
  const max = Math.max(1, ...list.map((p) => Math.abs(p.profit)));
  const losing = list.filter((p) => p.profit < 0).length;
  const withoutRevenue = list.filter((p) => !p.hasRevenue).length;

  return (
    <Card
      className="min-w-0"
      title="กำไร–ขาดทุนตามลูกค้า"
      description={`รายได้ที่นำเข้า − ต้นทุนเวลา · ขาดทุน ${losing} ราย${withoutRevenue ? ` · ไม่มีรายได้นำเข้า ${withoutRevenue} ราย` : ''} · กดแถวเพื่อเจาะดูลูกค้า`}
      actions={
        <div role="group" aria-label="เรียงตาม" className="flex flex-wrap gap-1 rounded-lg bg-white p-1 ring-1 ring-gray-300">
          {SORTS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={`h-7 rounded-md px-2.5 text-[12.5px] font-medium ${sort === k ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-3 p-3 sm:p-4"
    >
      {noRevenueYet && (
        <Alert tone="info">
          ยังไม่มีรายได้ในช่วงนี้ — ทุกลูกค้าจึงแสดงเป็นขาดทุนเท่ากับต้นทุน{' '}
          {canImport && (
            <Link href="/reports?tab=revenue" className="inline-flex items-center gap-1 font-medium underline">
              <Upload className="h-3.5 w-3.5" aria-hidden /> นำเข้ารายได้
            </Link>
          )}
        </Alert>
      )}
      {unmatched > 0 && (
        <Alert tone="warning">
          รายได้ ฿{baht(unmatched)} ยังไม่ได้จับคู่กับลูกค้า — นับในรายได้รวม แต่ไม่อยู่ในรายการด้านล่าง{' '}
          {canImport && (
            <Link href="/reports?tab=revenue" className="font-medium underline">
              จับคู่
            </Link>
          )}
        </Alert>
      )}
      {/* axis legend: which side is which, in words */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] px-2.5 text-[12px] text-gray-600" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-[#e34948]" /> ขาดทุน
        </span>
        <span className="flex items-center justify-end gap-1.5">
          กำไร <span className="h-2 w-3 rounded-sm bg-brand-500" />
        </span>
      </div>
      <ul className="space-y-0.5">
        {shown.map((p) => {
          const on = selected === p.id;
          const w = (Math.abs(p.profit) / max) * 50;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p.id)}
                aria-pressed={on}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-brand-600 ${on ? 'bg-brand-50 ring-1 ring-brand-300 ring-inset' : 'hover:bg-gray-50'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-gray-900" title={p.name}>
                    {p.name}
                  </span>
                  <span className="block text-[12px] text-gray-600">
                    {p.code} · รายได้ {p.hasRevenue ? `฿${bahtRound(p.revenue)}` : <span className="text-amber-700">ไม่มีนำเข้า</span>} · ต้นทุน ฿{bahtRound(p.cost)} · margin {pct(p.margin)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-right text-[13px] whitespace-nowrap tabular-nums">
                  {p.unpricedMinutes > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label={`มี ${hoursText(p.unpricedMinutes)} ชม. ที่ไม่มีอัตรา — ต้นทุนจริงอาจสูงกว่านี้`} />}
                  <span className="font-semibold text-gray-900">{signed(p.profit)}</span>
                  {p.profit < 0 && <span className="rounded bg-rose-50 px-1.5 text-[12px] font-medium text-rose-800 ring-1 ring-rose-200 ring-inset">ขาดทุน</span>}
                </span>
                {/* diverging track: zero in the middle */}
                <span className="relative col-span-2 block h-2 rounded-full bg-gray-100" aria-hidden>
                  <span className="absolute inset-y-[-2px] left-1/2 w-px bg-gray-400" />
                  {p.profit !== 0 && (
                    <span
                      className={`absolute inset-y-0 block ${p.profit > 0 ? 'left-1/2 rounded-r-[4px] bg-brand-500' : 'right-1/2 rounded-l-[4px] bg-[#e34948]'}`}
                      style={{ width: `${Math.max(w, 0.6)}%` }}
                    />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {list.length > TOP && (
        <button type="button" onClick={() => setAll(!all)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[13px] text-gray-700 ring-1 ring-gray-200 ring-inset hover:bg-gray-50">
          <span>{all ? 'แสดงเฉพาะ 10 อันดับ' : `แสดงทั้งหมด ${list.length} ราย`}</span>
          <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${all ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      )}
      {!list.length && <p className="py-6 text-center text-[13px] text-gray-600">ไม่มีลูกค้าที่มีรายได้หรือต้นทุนในช่วงนี้</p>}
      <p className="text-[12px] text-gray-600">
        กำไรขั้นต้น = รายได้ที่นำเข้า (เฉลี่ยตามจำนวนวันเมื่อช่วงไม่ตรงกับงวด) − ต้นทุนเวลา (ชั่วโมง × อัตราระดับ) · ยังไม่รวมค่าใช้จ่ายอื่น
      </p>
    </Card>
  );
}
