'use client';

/**
 * Two small charts for the interactive report, plain HTML (no chart library):
 *  - TrendColumns: one series over time; a column is a button (click = zoom the period to it)
 *  - RankedBars: totals per customer / activity / person …; a bar is a button (click = filter by it)
 * One series colour (brand-500, validated ≥ 3:1 on white). When something is selected the others fade to grey
 * (emphasis), so the selection stays readable without a second colour. Every value is also in a table.
 */

import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { type Analytics, type Bucket, compact, type Dim, type Group, labelOf, type Metric, metricText, ticks, value } from './explorer-data';

// ---------------------------------------------------------------------------

export function TrendColumns({ data, metric, onPick, selected }: { data: Bucket[]; metric: Metric; onPick: (b: Bucket) => void; selected?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((b) => value(b, metric)));
  const axis = ticks(max);
  const top = axis[axis.length - 1] || 1;
  // Label every nth column so labels never collide (≈ 7 labels across).
  const every = Math.max(1, Math.ceil(data.length / 7));
  const h = hover === null ? null : data[hover];

  return (
    <div className="relative select-none">
      <div className="flex">
        {/* y axis */}
        <div className="relative mr-2 h-48 w-10 shrink-0 text-right text-[11px] text-gray-500 tabular-nums" aria-hidden>
          {axis.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
              {compact(t)}
            </span>
          ))}
        </div>
        {/* plot */}
        <div className="relative h-48 min-w-0 flex-1 border-b border-gray-300">
          {axis.slice(1).map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-gray-200" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-stretch gap-[2px]" onPointerLeave={() => setHover(null)}>
            {data.map((b, i) => {
              const v = value(b, metric);
              const on = selected === b.from;
              return (
                <button
                  key={b.from}
                  type="button"
                  onClick={() => onPick(b)}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${b.label}: ${metricText(b, metric)} — กดเพื่อดูช่วงนี้`}
                  className="group flex min-w-0 flex-1 items-end justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <span
                    className={`block w-full max-w-6 rounded-t-[4px] transition-colors ${hover === i || on ? 'bg-brand-700' : 'bg-brand-500'}`}
                    style={{ height: v > 0 ? `max(2px, ${(v / top) * 100}%)` : 0 }}
                  />
                </button>
              );
            })}
          </div>
          {h && (
            <div
              className="pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-56 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-[12px] text-white shadow-pop"
              style={{ left: `clamp(4.5rem, ${((hover! + 0.5) / data.length) * 100}%, calc(100% - 4.5rem))` }}
              role="status"
            >
              <p className="text-[15px] font-semibold">{metricText(h, metric)}</p>
              <p className="text-gray-300">
                {h.from === h.to ? h.label : `${h.label} – ${labelEnd(h)}`}
                {metric === 'cost' ? ` · ${metricText(h, 'hours')}` : ''}
              </p>
              {metric === 'cost' && h.unpricedMinutes > 0 && <p className="text-amber-300">ไม่มีอัตรา {metricText({ ...h, minutes: h.unpricedMinutes }, 'hours')}</p>}
            </div>
          )}
        </div>
      </div>
      {/* x axis */}
      <div className="mt-1.5 ml-12 flex gap-[2px] text-[11px] text-gray-500" aria-hidden>
        {data.map((b, i) => (
          <span key={b.from} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
            {i % every === 0 ? b.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

const labelEnd = (b: Bucket) => {
  const [, m, d] = b.to.split('-').map(Number);
  return `${d} ${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m - 1]}`;
};

// ---------------------------------------------------------------------------

const TOP = 8;

export function RankedBars({
  d,
  dim,
  groups,
  metric,
  selected,
  onPick,
}: {
  d: Analytics;
  dim: Dim;
  groups: Group[];
  metric: Metric;
  selected?: string;
  onPick: (key: string) => void;
}) {
  const [all, setAll] = useState(false);
  const total = groups.reduce((a, g) => a + value(g, metric), 0);
  const max = Math.max(0, ...groups.map((g) => value(g, metric))) || 1;
  // Keep the selected one visible even when it is outside the top N.
  const shown = all ? groups : groups.slice(0, TOP).concat(groups.slice(TOP).filter((g) => g.key === selected));
  const rest = all ? [] : groups.slice(TOP).filter((g) => g.key !== selected);
  const restValue = rest.reduce((a, g) => a + value(g, metric), 0);

  return (
    <div>
      <ul className={`space-y-0.5 ${all ? 'max-h-[28rem] overflow-y-auto pr-1' : ''}`}>
        {shown.map((g) => {
          const v = value(g, metric);
          const on = selected === g.key;
          const faded = selected !== undefined && !on;
          const l = labelOf(d, dim, g.key);
          return (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => onPick(g.key)}
                aria-pressed={on}
                title={on ? 'กดอีกครั้งเพื่อยกเลิกตัวกรอง' : 'กดเพื่อกรองทั้งหน้าด้วยรายการนี้'}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand-600 ${
                  on ? 'bg-brand-50 ring-1 ring-brand-300 ring-inset' : 'hover:bg-gray-50'
                }`}
              >
                <span className="min-w-0">
                  <span className={`block truncate text-[13px] font-medium ${faded ? 'text-gray-600' : 'text-gray-900'}`}>{l.title}</span>
                  {l.sub && <span className="block truncate text-[12px] text-gray-500">{l.sub}</span>}
                </span>
                <span className="flex items-center gap-1.5 text-right text-[13px] whitespace-nowrap tabular-nums">
                  {metric === 'cost' && g.unpricedMinutes > 0 && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label={`มี ${metricText({ ...g, minutes: g.unpricedMinutes }, 'hours')} ที่ไม่มีอัตรา`} />
                  )}
                  <span className="font-semibold text-gray-900">{metricText(g, metric)}</span>
                  <span className="w-11 text-gray-500">{total ? `${Math.round((v / total) * 1000) / 10}%` : ''}</span>
                </span>
                <span className="col-span-2 block h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden>
                  <span className={`block h-full rounded-r-[4px] transition-colors ${faded ? 'bg-gray-300' : 'bg-brand-500'}`} style={{ width: `${(v / max) * 100}%` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {(rest.length > 0 || all) && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mt-2 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[13px] text-gray-700 ring-1 ring-gray-200 ring-inset hover:bg-gray-50"
        >
          <span>{all ? 'แสดงเฉพาะอันดับต้น' : `อื่น ๆ อีก ${rest.length} รายการ`}</span>
          <span className="flex items-center gap-1.5 tabular-nums">
            {!all && <span className="font-medium text-gray-900">{metric === 'cost' ? `฿${compact(restValue)}` : `${compact(restValue)} ชม.`}</span>}
            <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${all ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </button>
      )}
    </div>
  );
}
