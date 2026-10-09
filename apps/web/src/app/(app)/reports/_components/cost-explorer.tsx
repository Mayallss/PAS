'use client';

/**
 * ต้นทุน / ชั่วโมง — interactive report. One filter row scopes everything below it; clicking any bar or column
 * drills in (adds a filter / zooms the period); every state lives in the URL, so Back undoes a drill and a view
 * can be bookmarked or sent to a colleague (who still only sees their own scope).
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronUp, Inbox, Search, Table2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Alert, Card, Empty, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CATEGORY_DOT, thaiDate, thaiDateShort } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { RankedBars, TrendColumns } from './charts';
import { ProfitCard } from './profit';
import {
  type Analytics,
  applyFilters,
  autoGrain,
  baht,
  bahtRound,
  type Basis,
  type Bucket,
  buckets,
  daysBetween,
  type Dim,
  DIM_KEYS,
  DIMENSIONS,
  type Filters,
  type Grain,
  GRAIN_LABEL,
  groupBy,
  hoursText,
  keyOf,
  labelOf,
  type Metric,
  type Preset,
  PRESETS,
  presetRange,
  profitApplies,
  profitByCustomer,
  previousRange,
  type Row,
  totals,
  type Totals,
} from './explorer-data';

/** Selects size to their content (inputClass is full-width). */
const selectClass = inputClass.replace('w-full', 'w-auto');

/** Short URL names for the filters: ?c=<customer id>&e=<employee id>… */
const PARAM: Record<Dim, string> = { customer: 'c', activity: 'a', employee: 'e', team: 't', level: 'l', owner: 'o', type: 'w' };

function useExplorerState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const preset = (params.get('p') as Preset | null) ?? (params.get('from') ? null : 'month');
  const range = preset ? presetRange(preset) : { from: params.get('from') ?? '', to: params.get('to') ?? '' };
  const filters: Filters = {};
  for (const k of DIM_KEYS) {
    const v = params.get(PARAM[k]);
    if (v) filters[k] = v;
  }
  const state = {
    preset,
    ...range,
    basis: (params.get('b') === 'AT_DATE' ? 'AT_DATE' : 'CURRENT') as Basis,
    metric: (params.get('m') === 'hours' ? 'hours' : 'cost') as Metric,
    includeInternal: params.get('i') === '1',
    grain: (['day', 'week', 'month'].includes(params.get('g') ?? '') ? params.get('g') : null) as Grain | null,
    dims: [(params.get('d1') as Dim) ?? 'customer', (params.get('d2') as Dim) ?? 'employee'].map((d, i) => (DIM_KEYS.includes(d) ? d : i ? 'employee' : 'customer')) as [Dim, Dim],
    filters,
  };
  /** Push (Back undoes it) for drills; replace for typing in a date box. */
  function set(patch: Record<string, string | null>, mode: 'push' | 'replace' = 'push') {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) v === null || v === '' ? next.delete(k) : next.set(k, v);
    router[mode](`${pathname}?${next.toString()}`, { scroll: false });
  }
  return { state, set };
}

export function CostExplorer() {
  const me = useSession();
  const { state: s, set } = useExplorerState();
  const valid = !!s.from && !!s.to && s.from <= s.to && daysBetween(s.from, s.to) <= 366;
  const q = useQuery({
    queryKey: ['analytics', s.from, s.to, s.basis],
    enabled: valid,
    placeholderData: keepPreviousData,
    queryFn: () => api<Analytics>('/reports/analytics', { query: { from: s.from, to: s.to, basis: s.basis } }),
  });
  const prev = previousRange(s.from, s.to);
  const qPrev = useQuery({
    queryKey: ['analytics', prev.from, prev.to, s.basis],
    enabled: valid && !!q.data,
    placeholderData: keepPreviousData,
    queryFn: () => api<Analytics>('/reports/analytics', { query: { from: prev.from, to: prev.to, basis: s.basis } }),
  });

  const d = q.data;
  const priced = !!d?.priced;
  const metric: Metric = priced ? s.metric : 'hours';
  const grain = s.grain ?? autoGrain(s.from, s.to);
  const opts = { includeInternal: s.includeInternal };

  const view = useMemo(() => {
    if (!d) return null;
    const rows = applyFilters(d, s.filters, opts);
    return {
      rows,
      total: totals(rows),
      trend: buckets(rows, d.from, d.to, grain),
      // A panel grouped by X ignores the filter on X, so the chosen item stays visible among the others.
      panels: s.dims.map((dim) => groupBy(d, applyFilters(d, s.filters, { ...opts, except: dim }), dim, metric)),
      count: (dim: Dim) => new Set(rows.map((r) => keyOf(d, r, dim))).size,
      profit: d.revenue && profitApplies(s.filters) ? profitByCustomer(d, rows, s.filters) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, JSON.stringify(s.filters), s.includeInternal, grain, metric, s.dims[0], s.dims[1]]);
  const prevRows = qPrev.data && !qPrev.isPlaceholderData ? applyFilters(qPrev.data, s.filters, opts) : null;
  const prevTotal = prevRows ? totals(prevRows) : null;
  const prevProfit = prevRows && qPrev.data?.revenue && profitApplies(s.filters) ? profitByCustomer(qPrev.data, prevRows, s.filters) : null;

  const toggle = (dim: Dim, key: string) => set({ [PARAM[dim]]: s.filters[dim] === key ? null : key });
  const activeFilters = DIM_KEYS.filter((k) => s.filters[k] !== undefined);

  return (
    <div className="min-w-0 space-y-4">
      {/* ---------- filter row: scopes everything below ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="ช่วงเวลา" className="flex flex-wrap gap-1 rounded-lg bg-white p-1 shadow-card ring-1 ring-gray-300">
          {PRESETS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={s.preset === key}
              onClick={() => set({ p: key, from: null, to: null })}
              className={`h-8 rounded-md px-2.5 text-[13px] font-medium ${s.preset === key ? 'bg-brand-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input type="date" aria-label="ตั้งแต่วันที่" className={`${inputClass} w-[9.5rem]`} value={s.from} max={s.to} onChange={(e) => set({ p: null, from: e.target.value, to: s.to }, 'replace')} />
          <span className="text-gray-500">–</span>
          <input type="date" aria-label="ถึงวันที่" className={`${inputClass} w-[9.5rem]`} value={s.to} min={s.from} onChange={(e) => set({ p: null, from: s.from, to: e.target.value }, 'replace')} />
        </div>
        {priced && (
          <>
            <div role="group" aria-label="แสดงเป็น" className="flex gap-1 rounded-lg bg-white p-1 shadow-card ring-1 ring-gray-300">
              {(['cost', 'hours'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={metric === m} onClick={() => set({ m: m === 'cost' ? null : m })} className={`h-8 rounded-md px-2.5 text-[13px] font-medium ${metric === m ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
                  {m === 'cost' ? 'ต้นทุน (฿)' : 'ชั่วโมง'}
                </button>
              ))}
            </div>
            <select aria-label="ระดับที่ใช้คิดต้นทุน" className={selectClass} value={s.basis} onChange={(e) => set({ b: e.target.value === 'AT_DATE' ? 'AT_DATE' : null })}>
              <option value="CURRENT">คิดด้วยระดับปัจจุบัน</option>
              <option value="AT_DATE">คิดด้วยระดับ ณ วันที่ทำงาน</option>
            </select>
          </>
        )}
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-white px-3 text-[13px] text-gray-800 shadow-card ring-1 ring-gray-300">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={s.includeInternal} onChange={(e) => set({ i: e.target.checked ? '1' : null })} />
          รวมงานภายใน / ประชุม / ลา
        </label>
      </div>

      {!valid && <Alert tone="warning">เลือกช่วงวันที่ให้ถูกต้อง (วันเริ่มไม่เกินวันสิ้นสุด และไม่เกิน 1 ปี)</Alert>}

      {/* ---------- active drill filters ---------- */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="ตัวกรองที่เลือก">
          {activeFilters.map((k) => {
            const l = labelOf(d, k, s.filters[k]!);
            return (
              <span key={k} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-50 py-1 pr-1 pl-3 text-[13px] text-brand-900 ring-1 ring-brand-200 ring-inset">
                <span className="text-brand-700">{DIMENSIONS[k]}:</span>
                <span className="min-w-0 truncate font-medium">{l.sub && k === 'customer' ? `${l.sub} ${l.title}` : l.title}</span>
                <button type="button" onClick={() => set({ [PARAM[k]]: null })} aria-label={`เอาตัวกรอง ${DIMENSIONS[k]} ออก`} className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-brand-100">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
          <button type="button" onClick={() => set(Object.fromEntries(activeFilters.map((k) => [PARAM[k], null])))} className="h-8 rounded-md px-2 text-[13px] font-medium text-gray-700 underline-offset-2 hover:underline">
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      )}

      {q.isLoading ? (
        <Loading rows={6} />
      ) : q.error ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : d && view ? (
        <div className={`min-w-0 space-y-4 transition-opacity ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
          {priced && !d.units.length && (
            <Alert tone="warning">
              ยังไม่มีอัตราต้นทุน — {can(me, 'cost.write') ? <Link href="/admin/employees#cost-rates" className="font-medium underline">กำหนดอัตราตามระดับ</Link> : 'ให้ Admin กำหนดอัตราตามระดับ'} แล้วรายงานจะแสดงจำนวนเงิน
            </Alert>
          )}
          {metric === 'cost' && view.total.unpricedMinutes > 0 && !!d.units.length && (
            <Alert tone="warning">
              <span className="inline-flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> มี {hoursText(view.total.unpricedMinutes)} ชม. ที่คิดต้นทุนไม่ได้ (ไม่มีระดับ หรือระดับยังไม่มีอัตรา) — นับในชั่วโมง แต่ไม่นับเป็นเงิน
              </span>
            </Alert>
          )}

          <Kpis total={view.total} prev={prevTotal} prevRange={prev} priced={priced} customers={view.count('customer')} employees={view.count('employee')} pl={view.profit} prevPl={prevProfit} />

          {d.revenueHidden === 'TEAM_SCOPE' && <p className="text-[12.5px] text-gray-600">กำไร–ขาดทุนแสดงเฉพาะผู้ที่เห็นต้นทุนทุกทีม (รายได้เป็นของทั้งลูกค้า เทียบกับต้นทุนเฉพาะทีมจะให้กำไรสูงเกินจริง)</p>}
          {d.revenue && !view.profit && (
            <Alert tone="info">กำไร–ขาดทุนคิดได้ตามลูกค้าหรือผู้ดูแลลูกค้าเท่านั้น (รายได้ไม่ได้แยกตามพนักงานหรือ Activity) — เอาตัวกรองอื่นออกเพื่อดูกำไร</Alert>
          )}
          {view.profit && (view.profit.list.length > 0 || view.profit.unmatched > 0) && (
            <ProfitCard list={view.profit.list} unmatched={view.profit.unmatched} selected={s.filters.customer} onPick={(id) => toggle('customer', id)} canImport={can(me, 'revenue.write')} noRevenueYet={!d.revenue?.batches} />
          )}

          {view.rows.length === 0 ? (
            <Card>
              <Empty icon={<Inbox className="h-5 w-5" />} title="ไม่มีข้อมูลตามตัวกรองนี้">
                ลองขยายช่วงเวลา{activeFilters.length ? ' หรือเอาตัวกรองบางอันออก' : ''}
                {!s.includeInternal && ' · หรือติ๊ก “รวมงานภายใน / ประชุม / ลา”'}
              </Empty>
            </Card>
          ) : (
            <>
              <TrendCard data={view.trend} metric={metric} grain={grain} autoGrain={!s.grain} onGrain={(g) => set({ g: g === autoGrain(s.from, s.to) ? null : g })} onPick={(b) => set({ p: null, from: b.from, to: b.to, g: null })} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {[0, 1].map((i) => (
                  <Card
                    key={i}
                    className="min-w-0"
                    title={`แยกตาม${DIMENSIONS[s.dims[i]]}`}
                    description="กดแถบเพื่อเจาะดูเฉพาะรายการนั้น"
                    actions={
                      <select aria-label="แยกตาม" className={selectClass} value={s.dims[i]} onChange={(e) => set({ [`d${i + 1}`]: e.target.value })}>
                        {DIM_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {DIMENSIONS[k]}
                          </option>
                        ))}
                      </select>
                    }
                    bodyClassName="p-3 sm:p-4"
                  >
                    <RankedBars key={s.dims[i]} d={d} dim={s.dims[i]} groups={view.panels[i]} metric={metric} selected={s.filters[s.dims[i]]} onPick={(k) => toggle(s.dims[i], k)} />
                  </Card>
                ))}
              </div>
              <EntriesTable d={d} rows={view.rows} priced={priced} onFilter={toggle} filters={s.filters} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

type Pl = { revenue: number; cost: number } | null;

function Kpis({
  total,
  prev,
  prevRange,
  priced,
  customers,
  employees,
  pl,
  prevPl,
}: {
  total: Totals;
  prev: Totals | null;
  prevRange: { from: string; to: string };
  priced: boolean;
  customers: number;
  employees: number;
  pl: Pl;
  prevPl: Pl;
}) {
  const perHour = (t: Totals) => (t.minutes - t.unpricedMinutes > 0 ? t.cost / ((t.minutes - t.unpricedMinutes) / 60) : 0);
  const vs = `เทียบ ${thaiDateShort(prevRange.from)} – ${thaiDateShort(prevRange.to)}`;
  const profit = pl ? pl.revenue - pl.cost : 0;
  return (
    <div className={`grid grid-cols-2 gap-3 ${pl ? 'lg:grid-cols-3' : priced ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
      {pl && <Tile label="รายได้ (นำเข้า)" value={`฿${bahtRound(pl.revenue)}`} exact={`฿${baht(pl.revenue)}`} now={pl.revenue} before={prevPl?.revenue} vs={vs} />}
      {pl && (
        <Tile
          label="กำไรขั้นต้น"
          value={`${profit < 0 ? '−' : ''}฿${bahtRound(Math.abs(profit))}`}
          exact={`${profit < 0 ? '−' : ''}฿${baht(Math.abs(profit))}`}
          // A % change of a figure that can cross zero misleads; the margin says more.
          sub={pl.revenue ? `${profit < 0 ? 'ขาดทุน · ' : ''}margin ${Math.round((profit / pl.revenue) * 1000) / 10}%` : profit < 0 ? 'ขาดทุน · ยังไม่มีรายได้นำเข้า' : undefined}
        />
      )}
      {priced && <Tile label="ต้นทุนรวม" value={`฿${bahtRound(total.cost)}`} exact={`฿${baht(total.cost)}`} now={total.cost} before={prev?.cost} vs={vs} />}
      <Tile label="ชั่วโมงรวม" value={`${hoursText(total.minutes)} ชม.`} now={total.minutes} before={prev?.minutes} vs={vs} sub={`${total.entries.toLocaleString('th-TH')} รายการ`} />
      {priced && <Tile label="ต้นทุนเฉลี่ยต่อชั่วโมง" value={`฿${baht(perHour(total))}`} now={perHour(total)} before={prev ? perHour(prev) : undefined} vs={vs} sub="เฉพาะชั่วโมงที่มีอัตรา" />}
      <Tile label="ลูกค้า · พนักงาน" value={`${customers.toLocaleString('th-TH')} · ${employees.toLocaleString('th-TH')}`} sub="ที่มีชั่วโมงในช่วงนี้" />
    </div>
  );
}

function Tile({ label, value, exact, sub, now, before, vs }: { label: string; value: string; exact?: string; sub?: string; now?: number; before?: number; vs?: string }) {
  const pct = before && now !== undefined ? ((now - before) / before) * 100 : null;
  return (
    <div className="min-w-0 rounded-xl bg-white p-4 shadow-card ring-1 ring-gray-300/80">
      <p className="text-[12.5px] font-medium text-gray-600">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl" title={exact}>
        {value}
      </p>
      {pct !== null && Number.isFinite(pct) ? (
        // Up is neither good nor bad for cost or hours, so the delta stays neutral ink with an arrow.
        <p className="mt-1 flex items-center gap-1 text-[12px] text-gray-600" title={vs}>
          {pct >= 0 ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden />}
          <span className="font-medium text-gray-900">{`${pct >= 0 ? '+' : ''}${Math.round(pct * 10) / 10}%`}</span>
          <span className="truncate">ช่วงก่อนหน้า</span>
        </p>
      ) : (
        sub && <p className="mt-1 truncate text-[12px] text-gray-600">{sub}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TrendCard({ data, metric, grain, autoGrain: isAuto, onGrain, onPick }: { data: Bucket[]; metric: Metric; grain: Grain; autoGrain: boolean; onGrain: (g: Grain) => void; onPick: (b: Bucket) => void }) {
  const [table, setTable] = useState(false);
  return (
    <Card
      className="min-w-0"
      title={metric === 'cost' ? 'ต้นทุนตามช่วงเวลา' : 'ชั่วโมงตามช่วงเวลา'}
      description="กดแท่งเพื่อซูมเข้าไปดูช่วงนั้น · กด Back ของเบราว์เซอร์เพื่อย้อนกลับ"
      actions={
        <>
          <select aria-label="ความละเอียดของกราฟ" className={selectClass} value={grain} onChange={(e) => onGrain(e.target.value as Grain)}>
            {(['day', 'week', 'month'] as const).map((g) => (
              <option key={g} value={g}>
                {GRAIN_LABEL[g]}
                {isAuto && g === grain ? ' (อัตโนมัติ)' : ''}
              </option>
            ))}
          </select>
          <button type="button" aria-pressed={table} onClick={() => setTable(!table)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium ring-1 ring-inset ${table ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-800 ring-gray-300 hover:bg-gray-50'}`}>
            <Table2 className="h-4 w-4" aria-hidden /> ตาราง
          </button>
        </>
      }
      // pt-12: room above the plot for the hover tooltip.
      bodyClassName={table ? 'px-3 py-2 sm:px-5' : 'px-3 pt-12 pb-4 sm:px-5'}
    >
      {table ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-white text-left text-[12px] text-gray-600">
              <tr className="border-b border-gray-200">
                <th className="py-2 font-medium">ช่วง</th>
                <th className="py-2 text-right font-medium">ชั่วโมง</th>
                {metric === 'cost' && <th className="py-2 text-right font-medium">ต้นทุน (฿)</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.from} className="border-b border-gray-200">
                  <td className="py-1.5">{b.from === b.to ? thaiDate(b.from) : `${thaiDateShort(b.from)} – ${thaiDate(b.to)}`}</td>
                  <td className="py-1.5 text-right tabular-nums">{b.minutes ? hoursText(b.minutes) : '–'}</td>
                  {metric === 'cost' && <td className="py-1.5 text-right tabular-nums">{b.cost ? baht(b.cost) : '–'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <TrendColumns data={data} metric={metric} onPick={onPick} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

type SortKey = 'date' | 'minutes' | 'cost';
const PAGE = 50;

function EntriesTable({ d, rows, priced, onFilter, filters }: { d: Analytics; rows: Row[]; priced: boolean; onFilter: (dim: Dim, key: string) => void; filters: Filters }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true });
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const term = search.trim().toLowerCase();
  const list = useMemo(() => {
    const matched = term
      ? rows.filter((r) => {
          const c = d.customers[r[1]];
          return [c.code, c.name, d.activities[r[2]].name, d.employees[r[3]].name, r[4]].join(' ').toLowerCase().includes(term);
        })
      : rows;
    const by = (r: Row) => (sort.key === 'date' ? r[0] : sort.key === 'minutes' ? r[5] : (r[6] ?? -1));
    return [...matched].sort((a, b) => (by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : 0) * (sort.desc ? -1 : 1));
  }, [rows, term, sort, d]);
  const sum = totals(list);

  const head = (key: SortKey, label: string) => (
    <th className="px-3 py-2 text-right font-medium" aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : true })} className="inline-flex items-center gap-1 hover:text-gray-900">
        {label}
        {sort.key === key && (sort.desc ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />)}
      </button>
    </th>
  );
  const pick = (dim: Dim, key: string, text: React.ReactNode) =>
    filters[dim] === key ? (
      <span className="text-gray-900">{text}</span>
    ) : (
      <button type="button" onClick={() => onFilter(dim, key)} className="text-left text-gray-900 underline-offset-2 hover:text-brand-700 hover:underline" title={`กรองด้วย${DIMENSIONS[dim]}นี้`}>
        {text}
      </button>
    );

  return (
    <Card
      className="min-w-0"
      title="รายการบันทึกเวลา"
      description={`${list.length.toLocaleString('th-TH')} รายการ · กดชื่อลูกค้า / Activity / พนักงาน เพื่อกรอง`}
      actions={
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden />
          <input
            aria-label="ค้นหาในรายการ"
            placeholder="ค้นหาลูกค้า Activity ชื่อ"
            className={`${inputClass} pl-9 max-sm:text-base`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE);
            }}
          />
        </div>
      }
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-[13px]">
          <thead className="text-left text-[12px] text-gray-600">
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-3 py-2 font-medium sm:pl-5" aria-sort={sort.key === 'date' ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                <button type="button" onClick={() => setSort({ key: 'date', desc: sort.key === 'date' ? !sort.desc : true })} className="inline-flex items-center gap-1 hover:text-gray-900">
                  วันที่ {sort.key === 'date' && (sort.desc ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />)}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">ลูกค้า</th>
              <th className="px-3 py-2 font-medium">Activity</th>
              <th className="px-3 py-2 font-medium">พนักงาน</th>
              <th className="px-3 py-2 font-medium">ระดับ</th>
              {head('minutes', 'ชม.')}
              {priced && head('cost', 'ต้นทุน (฿)')}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((r, i) => {
              const c = d.customers[r[1]];
              const a = d.activities[r[2]];
              const e = d.employees[r[3]];
              return (
                <tr key={`${r[0]}-${r[1]}-${r[2]}-${r[3]}-${i}`} className="border-b border-gray-200 align-top hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 sm:pl-5">{thaiDateShort(r[0])}</td>
                  <td className="max-w-56 px-3 py-2">
                    {pick('customer', c.id, <><span className="font-mono text-[12px] text-gray-500">{c.code}</span> {c.name}</>)}
                  </td>
                  <td className="max-w-56 px-3 py-2">
                    <span className="inline-flex items-start gap-1.5">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[a.type]}`} aria-hidden />
                      {pick('activity', a.id, a.name)}
                    </span>
                  </td>
                  <td className="max-w-48 px-3 py-2">{pick('employee', e.id, e.name)}</td>
                  <td className="px-3 py-2 text-gray-700">{r[4] === '-' ? '–' : pick('level', r[4], r[4])}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{hoursText(r[5])}</td>
                  {priced && <td className="px-3 py-2 text-right tabular-nums">{r[6] === null ? <span className="text-amber-700">ไม่มีอัตรา</span> : baht(r[6])}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold">
              <td colSpan={5} className="px-3 py-2.5 text-right sm:pl-5">
                รวม {list.length.toLocaleString('th-TH')} รายการ
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{hoursText(sum.minutes)}</td>
              {priced && <td className="px-3 py-2.5 text-right tabular-nums">{baht(sum.cost)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      {list.length > limit && (
        <div className="border-t border-gray-200 p-3 text-center">
          <button type="button" onClick={() => setLimit(limit + PAGE * 4)} className="h-9 rounded-lg px-4 text-[13px] font-medium text-gray-800 ring-1 ring-gray-300 ring-inset hover:bg-gray-50">
            แสดงเพิ่ม ({(list.length - limit).toLocaleString('th-TH')} รายการที่เหลือ)
          </button>
        </div>
      )}
      {!list.length && <p className="p-5 text-center text-[13px] text-gray-600">ไม่พบรายการที่ตรงกับ “{search}”</p>}
      {!priced && <p className="border-t border-gray-200 px-5 py-2.5 text-[12px] text-gray-600">แสดงเฉพาะชั่วโมง — ต้นทุนเห็นได้เฉพาะผู้มีสิทธิ์ดูต้นทุน</p>}
    </Card>
  );
}
