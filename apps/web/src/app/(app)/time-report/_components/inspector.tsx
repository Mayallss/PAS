'use client';

import { Keyboard, MessageSquareText, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, inputClass, Kbd } from '@/components/ui';
import { CATEGORY_DOT, CATEGORY_LABEL, hours, STATUS_STYLE, THAI_WEEKDAY_LONG, thaiDate } from '@/lib/format';
import type { WeekRow, WeekView } from '@/lib/types';
import type { SaveInput } from '../_lib/timesheet-data';
import type { CellRef } from './week-grid';

/** Right-hand panel: details and note for the focused cell, plus that day's breakdown. */
export function Inspector({ view, rows, selected, onSave }: { view: WeekView; rows: WeekRow[]; selected: CellRef | null; onSave: (input: SaveInput) => void }) {
  const row = selected && rows.find((r) => r.engagementId === selected.engagementId);
  const day = selected && view.days.find((d) => d.date === selected.date);
  const entry = row && selected ? row.cells[selected.date] : undefined;
  const live = entry && !entry.deleted ? entry : undefined;
  const [note, setNote] = useState('');

  useEffect(() => setNote(live?.description ?? ''), [live?.id, live?.description, selected?.engagementId, selected?.date]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row || !day || !selected) {
    return (
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-2 text-[13px] font-medium text-gray-900">
          <Keyboard className="h-4 w-4 text-gray-400" /> ใช้งานเร็วด้วยคีย์บอร์ด
        </div>
        <ul className="space-y-2.5 text-[13px] text-gray-600">
          <li>พิมพ์ชั่วโมงลงช่องได้ทันที เช่น <Kbd>2</Kbd> <Kbd>2.5</Kbd> <Kbd>2:30</Kbd> <Kbd>90m</Kbd></li>
          <li><Kbd>Enter</Kbd> บันทึกแล้วลงแถวถัดไป</li>
          <li><Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> เลื่อนช่อง</li>
          <li>ลบค่าให้ว่างแล้วกด <Kbd>Enter</Kbd> เพื่อลบรายการ</li>
          <li><Kbd>Ctrl K</Kbd> ค้นหาหน้าหรือคำสั่ง</li>
        </ul>
        <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-[12px] text-gray-500">ระบบบันทึกอัตโนมัติทุกครั้งที่ออกจากช่อง — ไม่ต้องกดปุ่มบันทึก</p>
      </div>
    );
  }

  const dayEntries = rows
    .map((r) => ({ r, e: r.cells[day.date] }))
    .filter(({ e }) => e && !e.deleted);
  const editable = view.editable && !day.locked;
  const noteChanged = (live?.description ?? '') !== note;

  return (
    <div className="divide-y divide-gray-100">
      <div className="space-y-3 p-5">
        <div>
          <p className="text-[12px] text-gray-500">วัน{THAI_WEEKDAY_LONG[day.weekday]}</p>
          <p className="text-[15px] font-semibold text-gray-900">{thaiDate(day.date)}</p>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg bg-gray-50 p-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[row.workCategory.type]}`} />
          <div className="min-w-0 text-[13px]">
            <p className="font-medium text-gray-900">
              <span className="font-mono text-[12px] text-gray-500">{row.customer.code}</span> {row.customer.name}
            </p>
            <p className="text-gray-600">{row.workCategory.name}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">{CATEGORY_LABEL[row.workCategory.type]}</p>
          </div>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-gray-500">เวลา</span>
          <span className="text-xl font-semibold text-gray-900 tabular-nums">{live ? `${hours(live.durationMinutes)} ชม.` : '–'}</span>
        </div>
        <div>
          <label htmlFor="entry-note" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-gray-700">
            <MessageSquareText className="h-3.5 w-3.5 text-gray-400" /> รายละเอียดงาน
          </label>
          <textarea
            id="entry-note"
            className={inputClass}
            rows={3}
            maxLength={500}
            disabled={!editable || !live}
            placeholder={live ? 'ทำอะไรไปบ้าง (ไม่บังคับ)' : 'กรอกชั่วโมงในช่องก่อน แล้วจึงเพิ่มรายละเอียด'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => live && noteChanged && onSave({ task: row, date: day.date, minutes: live.durationMinutes, description: note })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.blur();
            }}
          />
          <p className="mt-1 text-[11px] text-gray-400">บันทึกอัตโนมัติเมื่อคลิกออก · <Kbd>Ctrl Enter</Kbd></p>
        </div>
        {live && editable && (
          <Button variant="danger" size="sm" onClick={() => onSave({ task: row, date: day.date, minutes: null })}>
            <Trash2 className="h-3.5 w-3.5" /> ลบรายการนี้
          </Button>
        )}
      </div>

      <div className="space-y-2.5 p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-medium text-gray-900">สรุปวันนี้</p>
          <p className={`text-[13px] font-semibold tabular-nums ${STATUS_STYLE[day.status].text}`}>
            {hours(day.totalMinutes) || 0} / {hours(day.requiredMinutes) || 0} ชม.
          </p>
        </div>
        {dayEntries.length === 0 ? (
          <p className="text-[12px] text-gray-500">ยังไม่มีรายการ</p>
        ) : (
          <ul className="space-y-1.5">
            {dayEntries.map(({ r, e }) => (
              <li key={r.engagementId} className="flex items-center gap-2 text-[12px]">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT[r.workCategory.type]}`} />
                <span className="min-w-0 flex-1 truncate text-gray-600">
                  {r.customer.code} · {r.workCategory.name}
                </span>
                <span className="font-medium text-gray-900 tabular-nums">{hours(e!.durationMinutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
