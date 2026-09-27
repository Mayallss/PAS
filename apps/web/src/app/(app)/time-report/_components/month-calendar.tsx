'use client';

import { Lock } from 'lucide-react';
import { hours, STATUS_STYLE, THAI_WEEKDAY_SHORT } from '@/lib/format';
import type { MonthSummary } from '@/lib/types';

/** Month at a glance: each day shows hours and a status bar; click a day to open its week. */
export function MonthCalendar({ data, onPickDay }: { data: MonthSummary; onPickDay: (date: string) => void }) {
  const lead = data.days[0].weekday - 1; // Monday-first grid
  return (
    <div className="p-3 sm:p-4">
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {[1, 2, 3, 4, 5, 6, 7].map((w) => (
          <div key={w} className={`pb-1 text-center text-[11px] font-medium ${w >= 6 ? 'text-rose-500' : 'text-gray-500'}`}>
            {THAI_WEEKDAY_SHORT[w]}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {data.days.map((d) => {
          const s = STATUS_STYLE[d.status];
          const isToday = d.date === data.today;
          const future = d.date > data.today;
          const off = d.requiredMinutes === 0;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onPickDay(d.date)}
              className={`group relative flex min-h-[78px] flex-col rounded-xl p-2 text-left ring-1 transition hover:ring-brand-500 sm:min-h-[92px] sm:p-2.5 ${
                off ? 'bg-gray-50 ring-gray-100' : 'bg-white ring-gray-200'
              } ${isToday ? 'ring-2 ring-brand-600' : ''}`}
              aria-label={`${d.date}: ${hours(d.totalMinutes) || 0} ชม. ${s.label}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[12px] font-semibold ${isToday ? 'text-brand-700' : off ? 'text-gray-400' : 'text-gray-700'}`}>{Number(d.date.slice(8))}</span>
                {d.locked && <Lock className="h-3 w-3 text-gray-300" aria-hidden />}
              </div>
              {d.holiday && <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-rose-500">{d.holiday.description}</span>}
              <span className={`mt-auto text-[17px] font-semibold tabular-nums sm:text-lg ${d.totalMinutes ? s.text : 'text-gray-300'}`}>
                {hours(d.totalMinutes) || (off || future ? '' : '0')}
              </span>
              {!off && (
                <span className="mt-1 h-1 overflow-hidden rounded-full bg-gray-100">
                  <span className={`block h-full rounded-full ${future && !d.totalMinutes ? '' : s.bar}`} style={{ width: `${Math.min(100, (d.totalMinutes / d.requiredMinutes) * 100)}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
