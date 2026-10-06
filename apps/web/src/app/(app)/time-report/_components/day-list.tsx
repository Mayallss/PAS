'use client';

import { CATEGORY_DOT, hours, STATUS_STYLE, THAI_WEEKDAY_SHORT, thaiDate } from '@/lib/format';
import type { Task, WeekRow, WeekView } from '@/lib/types';
import { AddTask } from './add-task';
import { CellInput } from './cell-input';

/** Phone layout: pick a day, then a simple list of tasks with one hours field each. */
export function DayList({ view, rows, day, onDay, onCommit, onAddTask }: {
  view: WeekView;
  rows: WeekRow[];
  day: string;
  onDay: (date: string) => void;
  onCommit: (task: Task, date: string, minutes: number | null) => void;
  onAddTask: (task: Task) => void;
}) {
  const info = view.days.find((d) => d.date === day) ?? view.days[0];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 border-b border-gray-100 p-2" role="tablist" aria-label="เลือกวัน">
        {view.days.map((d) => {
          const active = d.date === info.date;
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onDay(d.date)}
              className={`flex flex-col items-center rounded-lg py-1.5 ${active ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
            >
              <span className="text-[10px]">{THAI_WEEKDAY_SHORT[d.weekday]}</span>
              <span className="text-[15px] font-semibold">{Number(d.date.slice(8))}</span>
              <span className={`mt-1 h-1 w-4 rounded-full ${d.requiredMinutes > 0 || d.totalMinutes ? STATUS_STYLE[d.status].bar : 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>
      <div className="flex items-baseline justify-between px-4 py-3">
        <p className="text-[13px] font-medium text-gray-900">{thaiDate(info.date)}</p>
        <p className={`text-[13px] font-semibold tabular-nums ${STATUS_STYLE[info.status].text}`}>
          {hours(info.totalMinutes) || 0} / {hours(info.requiredMinutes) || 0} ชม.
        </p>
      </div>
      {info.holiday && <p className="px-4 pb-2 text-[12px] text-rose-500">{info.holiday.description}</p>}
      <ul className="divide-y divide-gray-100">
        {rows.map((r, i) => (
          <li key={r.engagementId} className="flex items-center gap-3 px-4 py-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[r.workCategory.type]}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px]">
                <span className="font-mono text-[12px] text-gray-500">{r.customer.code}</span> {r.customer.name}
              </p>
              <p className="truncate text-[12px] text-gray-500">{r.workCategory.name}</p>
            </div>
            <div className="w-20 rounded-lg ring-1 ring-gray-200">
              <CellInput
                scope="day"
                row={i}
                col={0}
                entry={r.cells[info.date]}
                policy={view.policy}
                readOnly={!view.editable || info.locked || r.workCategory.type === 'LEAVE' || (!r.cells[info.date] && !r.active)}
                label={`${r.customer.code} ${r.workCategory.name} ${thaiDate(info.date)}`}
                onCommit={(m) => onCommit(r, info.date, m)}
              />
            </div>
          </li>
        ))}
      </ul>
      {view.editable && (
        <div className="px-2 py-1">
          <AddTask recent={view.recentEngagements} exclude={new Set(rows.map((r) => r.engagementId))} onAdd={onAddTask} />
        </div>
      )}
    </div>
  );
}
