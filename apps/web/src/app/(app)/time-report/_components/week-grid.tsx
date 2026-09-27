'use client';

import { Lock, X } from 'lucide-react';
import { CATEGORY_DOT, hours, STATUS_STYLE, THAI_WEEKDAY_SHORT, thaiDate } from '@/lib/format';
import type { Task, WeekRow, WeekView } from '@/lib/types';
import { AddTask } from './add-task';
import { CellInput } from './cell-input';

export interface CellRef {
  engagementId: string;
  date: string;
}

interface Props {
  view: WeekView;
  rows: WeekRow[];
  selected: CellRef | null;
  onSelect: (cell: CellRef) => void;
  onCommit: (task: Task, date: string, minutes: number | null) => void;
  onAddTask: (task: Task) => void;
  onHideRow: (engagementId: string) => void;
}

/** Desktop weekly timesheet: tasks × 7 days, edit in place like a spreadsheet. */
export function WeekGrid({ view, rows, selected, onSelect, onCommit, onAddTask, onHideRow }: Props) {
  const scope = 'week';
  const canEdit = view.editable;
  const colClass = (d: WeekView['days'][number]) =>
    `${d.date === view.today ? 'bg-brand-50/60' : d.weekend || d.holiday ? 'bg-gray-50' : ''}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] table-fixed border-separate border-spacing-0">
        <thead>
          <tr className="text-left">
            <th scope="col" className="sticky left-0 z-10 w-[32%] border-b border-gray-200 bg-white px-4 py-2.5 text-[12px] font-medium text-gray-500">
              งาน
            </th>
            {view.days.map((d) => {
              const isToday = d.date === view.today;
              return (
                <th key={d.date} scope="col" className={`border-b border-gray-200 px-1 py-2 text-center font-normal ${d.weekend ? 'w-[7%]' : 'w-[9%]'} ${colClass(d)}`} title={d.holiday?.description}>
                  <div className={`text-[11px] ${d.weekend || d.holiday ? 'text-rose-500' : 'text-gray-500'}`}>{THAI_WEEKDAY_SHORT[d.weekday]}</div>
                  <div className={`mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold ${isToday ? 'bg-brand-600 text-white' : 'text-gray-900'}`}>
                    {Number(d.date.slice(8))}
                  </div>
                  {d.holiday ? (
                    <div className="mx-auto mt-0.5 max-w-[5.5rem] truncate text-[10px] text-rose-500">{d.holiday.description}</div>
                  ) : d.locked ? (
                    <Lock className="mx-auto mt-0.5 h-3 w-3 text-gray-400" aria-label="ปิดงวดแล้ว" />
                  ) : (
                    <div className="h-[15px]" />
                  )}
                </th>
              );
            })}
            <th scope="col" className="w-[8%] border-b border-gray-200 px-3 text-right text-[12px] font-medium text-gray-500">
              รวม
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const empty = r.totalMinutes === 0;
            return (
              <tr key={r.engagementId} className={`group ${r.carried ? 'opacity-70 hover:opacity-100 focus-within:opacity-100' : ''}`}>
                <th scope="row" className="sticky left-0 z-10 border-b border-gray-100 bg-white px-4 py-1.5 text-left font-normal">
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[r.workCategory.type]}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-gray-900">
                        <span className="font-mono text-[12px] text-gray-500">{r.customer.code}</span> {r.customer.name}
                      </p>
                      <p className="truncate text-[12px] text-gray-500">
                        {r.workCategory.name}
                        {r.carried && <span className="ml-1.5 text-gray-400">· จากสัปดาห์ก่อน</span>}
                        {!r.active && <span className="ml-1.5 text-rose-500">· ปิดแล้ว</span>}
                      </p>
                    </div>
                    {empty && canEdit && (
                      <button
                        type="button"
                        onClick={() => onHideRow(r.engagementId)}
                        className="rounded p-1 text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600 focus:opacity-100"
                        aria-label={`ซ่อนแถว ${r.customer.code} ${r.workCategory.name}`}
                        title="ซ่อนแถว"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </th>
                {view.days.map((d, ci) => {
                  const entry = r.cells[d.date];
                  const readOnly = !canEdit || d.locked || (!entry && !r.active);
                  const isSel = selected?.engagementId === r.engagementId && selected.date === d.date;
                  return (
                    <td key={d.date} className={`border-b border-gray-100 p-0.5 ${colClass(d)} ${isSel ? 'bg-brand-50' : ''}`}>
                      <CellInput
                        scope={scope}
                        row={ri}
                        col={ci}
                        entry={entry}
                        policy={view.policy}
                        readOnly={readOnly}
                        label={`${r.customer.code} ${r.workCategory.name} ${thaiDate(d.date)}`}
                        onFocusCell={() => onSelect({ engagementId: r.engagementId, date: d.date })}
                        onCommit={(m) => onCommit(r, d.date, m)}
                      />
                    </td>
                  );
                })}
                <td className="border-b border-gray-100 px-3 text-right text-[14px] font-semibold text-gray-900 tabular-nums">{hours(r.totalMinutes) || <span className="text-gray-300">–</span>}</td>
              </tr>
            );
          })}
          {canEdit && (
            <tr>
              <td colSpan={view.days.length + 2} className="border-b border-gray-100 px-2 py-1">
                <AddTask recent={view.recentEngagements} exclude={new Set(rows.map((r) => r.engagementId))} onAdd={onAddTask} autoOpen={rows.length === 0} />
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-[13px] font-medium text-gray-700">
              รวมต่อวัน
            </th>
            {view.days.map((d) => {
              const s = STATUS_STYLE[d.status];
              return (
                <td key={d.date} className={`px-1.5 py-2.5 text-center ${colClass(d)}`}>
                  <div className={`text-[13px] font-semibold tabular-nums ${s.text}`}>{hours(d.totalMinutes) || '–'}</div>
                  {d.requiredMinutes > 0 && (
                    <div className="mx-auto mt-1.5 h-1 w-10 overflow-hidden rounded-full bg-gray-100" title={`${s.label} · ${hours(d.totalMinutes) || 0}/${hours(d.requiredMinutes)} ชม.`}>
                      <div className={`h-full rounded-full ${s.bar} transition-[width] duration-300`} style={{ width: `${Math.min(100, (d.totalMinutes / d.requiredMinutes) * 100)}%` }} />
                    </div>
                  )}
                </td>
              );
            })}
            <td className="px-3 text-right text-[15px] font-bold text-gray-900 tabular-nums">{hours(view.totals.recordedMinutes) || '0'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
