'use client';

import { AlarmClock, Check, Clock, Loader, MessageSquareText, Minus, Plus, StickyNote, UserRoundCheck } from 'lucide-react';
import { memo } from 'react';
import type { TodoItem } from '@/lib/types';
import { hrs, isLate, PRIORITY } from './plan-style';

interface Props {
  item: TodoItem;
  today: string;
  step: number;
  max: number;
  editable: boolean;
  onToggleDone: (item: TodoItem) => void;
  onMinutes: (item: TodoItem, minutes: number) => void;
  onOpen: (item: TodoItem) => void;
}

/** One planned task. Drag to another day to reschedule; click the text for details. */
export const PlanCard = memo(function PlanCard({ item, today, step, max, editable, onToggleDone, onMinutes, onOpen }: Props) {
  const done = item.status === 'DONE';
  const cancelled = item.status === 'CANCELLED';
  const late = isLate(item, today);
  const pending = item.id.startsWith('temp-');
  const custom = item.kind === 'CUSTOM';
  const planned = item.plannedMinutes ?? 0;
  // Compare with the whole plan for this task and day (the timesheet has one cell per task and day).
  const taskDay = item.taskDayPlannedMinutes ?? planned;
  const shared = taskDay !== planned;
  const over = item.actualMinutes > taskDay;
  // Custom items are notes: nothing is logged against them.
  const showActual = !custom && (item.actualMinutes > 0 || (item.workDate <= today && !cancelled));

  return (
    <div
      draggable={editable && !pending}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`group relative overflow-hidden rounded-lg pl-3 pr-2 py-2 transition ${
        custom ? 'border border-dashed border-gray-300 bg-white/70' : `bg-white shadow-card ring-1 ring-inset ${late ? 'ring-rose-200' : 'ring-gray-200'}`
      } ${editable && !pending ? 'cursor-grab active:cursor-grabbing hover:ring-brand-300' : ''} ${cancelled ? 'opacity-55' : ''} ${pending ? 'opacity-70' : ''}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${PRIORITY[item.priority].bar}`} aria-hidden />
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? 'ทำเครื่องหมายว่ายังไม่เสร็จ' : 'ทำเครื่องหมายว่าเสร็จแล้ว'}
          disabled={!editable || cancelled || pending}
          onClick={() => onToggleDone(item)}
          className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ring-1 ring-inset transition ${
            done ? 'bg-emerald-500 text-white ring-emerald-500' : 'bg-white text-transparent ring-gray-300 hover:text-gray-300 hover:ring-emerald-400'
          } disabled:cursor-default`}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </button>
        {item.task ? (
          <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left" aria-label={`รายละเอียด ${item.task.customer.code} ${item.task.workCategory.name}`}>
            <p className={`truncate text-[13px] leading-5 text-gray-900 ${done || cancelled ? 'line-through decoration-gray-400' : ''}`} title={`${item.task.customer.code} ${item.task.customer.name}`}>
              <span className="font-mono text-[11.5px] text-gray-500">{item.task.customer.code}</span> {item.task.customer.name}
            </p>
            <p className="truncate text-[12px] leading-4 text-gray-500">{item.task.workCategory.name}</p>
          </button>
        ) : (
          <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left" aria-label={`รายละเอียด ${item.title}`}>
            <p className={`line-clamp-2 text-[13px] leading-5 text-gray-900 ${done || cancelled ? 'line-through decoration-gray-400' : ''}`} title={item.title ?? ''}>
              {item.title}
            </p>
            <p className="flex items-center gap-1 text-[11.5px] leading-4 text-amber-700">
              <StickyNote className="h-3 w-3" /> งานอื่น · ไม่นับในประมาณการ
            </p>
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[26px]">
        {item.plannedMinutes === null ? (
          editable && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onMinutes(item, step)}
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-gray-400 ring-1 ring-inset ring-gray-200 hover:text-gray-700"
            >
              <Clock className="h-3 w-3" /> ใส่เวลา
            </button>
          )
        ) : (
        <div className={`flex items-center rounded-md ring-1 ring-inset ring-gray-200 ${editable ? '' : 'bg-gray-50'}`}>
          {editable && (
            <button
              type="button"
              aria-label="ลดเวลา"
              disabled={pending || (!custom && planned <= step)}
              onClick={() => onMinutes(item, planned - step)}
              className="grid h-6 w-6 place-items-center rounded-l-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
            >
              <Minus className="h-3 w-3" />
            </button>
          )}
          <span className="whitespace-nowrap px-1.5 text-[12px] font-medium text-gray-800 tabular-nums" title="เวลาที่วางแผน (ประมาณการ)">
            {hrs(planned)}
          </span>
          {editable && (
            <button
              type="button"
              aria-label="เพิ่มเวลา"
              disabled={pending || planned + step > max}
              onClick={() => onMinutes(item, planned + step)}
              className="grid h-6 w-6 place-items-center rounded-r-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
        </div>
        )}
        {showActual && (
          <span
            title={shared ? `เวลาจริงรวมของงานนี้ทั้งวัน เทียบกับแผนรวม ${hrs(taskDay)}` : 'เวลาจริงจากบันทึกเวลา (งานเดียวกัน วันเดียวกัน)'}
            className={`rounded-md px-1.5 py-0.5 text-[11.5px] tabular-nums ${
              item.actualMinutes === 0 ? 'text-gray-400' : over ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {item.actualMinutes === 0 ? 'ยังไม่ลงเวลา' : `จริง ${hrs(item.actualMinutes)}${shared ? ` / แผนรวม ${hrs(taskDay)}` : ''}`}
          </span>
        )}
        {late && (
          <span className="flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11.5px] font-medium text-rose-700">
            <AlarmClock className="h-3 w-3" /> เลยกำหนด
          </span>
        )}
        {item.status === 'IN_PROGRESS' && (
          <span className="flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[11.5px] font-medium text-sky-700">
            <Loader className="h-3 w-3" /> กำลังทำ
          </span>
        )}
        {item.assignedBy && (
          <span className="flex items-center gap-1 text-[11.5px] text-gray-500" title={`มอบหมายโดย ${item.assignedBy.fullName}`}>
            <UserRoundCheck className="h-3 w-3" /> {item.assignedBy.nickname ?? item.assignedBy.fullName}
          </span>
        )}
        {item.note && <MessageSquareText className="h-3.5 w-3.5 text-gray-400" aria-label={`หมายเหตุ: ${item.note}`} />}
      </div>
    </div>
  );
});
