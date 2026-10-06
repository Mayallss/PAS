'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Dialog, Field, inputClass } from '@/components/ui';
import { parseDuration, thaiDate } from '@/lib/format';
import type { TodoItem, TodoPriority, TodoStatus } from '@/lib/types';
import type { ItemPatch } from '../_lib/plan-data';
import { hrs, PRIORITY, PRIORITY_ORDER, STATUS, STATUS_ORDER } from './plan-style';

interface Props {
  item: TodoItem;
  own: boolean;
  editable: boolean;
  step: number;
  max: number;
  onClose: () => void;
  onSave: (patch: ItemPatch) => void;
  onDelete: () => void;
}

function Segmented<T extends string>({ value, options, label, onChange, disabled }: { value: T; options: { value: T; label: string; className?: string }[]; label: string; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-lg px-3 text-[13px] font-medium ring-1 ring-inset transition disabled:opacity-60 ${
            value === o.value ? `${o.className ?? 'bg-brand-50 text-brand-700 ring-brand-300'} ring-2` : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EditItem({ item, own, editable, step, max, onClose, onSave, onDelete }: Props) {
  const custom = item.kind === 'CUSTOM';
  const [title, setTitle] = useState(item.title ?? '');
  const [workDate, setWorkDate] = useState(item.workDate);
  const [time, setTime] = useState(item.plannedMinutes === null ? '' : String(item.plannedMinutes / 60));
  const [priority, setPriority] = useState<TodoPriority>(item.priority);
  const [status, setStatus] = useState<TodoStatus>(item.status);
  const [note, setNote] = useState(item.note ?? '');
  const minutes = parseDuration(time);
  // Custom items may have no time at all.
  const timeError =
    custom && minutes === null
      ? null
      : minutes === null || Number.isNaN(minutes) || minutes <= 0
      ? 'ระบุเวลา เช่น 1.5 หรือ 1:30'
      : minutes % step !== 0
        ? `ต้องเป็นทวีคูณของ ${step} นาที`
        : minutes > max
          ? `งานเดียวไม่เกิน ${hrs(max)} — แบ่งเป็นหลายวันแทน`
          : null;
  // Work a lead assigned is cancelled by the assignee, not deleted, so the lead still sees what happened.
  const canDelete = editable && !(own && item.assignedBy);

  const save = () => {
    const patch: ItemPatch = {};
    if (custom && title.trim() && title.trim() !== item.title) patch.title = title.trim();
    if (workDate !== item.workDate) patch.workDate = workDate;
    if (minutes !== item.plannedMinutes && (minutes || custom)) patch.plannedMinutes = minutes ?? null;
    if (priority !== item.priority) patch.priority = priority;
    if (status !== item.status) patch.status = status;
    if ((note.trim() || null) !== item.note) patch.note = note.trim() || null;
    if (Object.keys(patch).length) onSave(patch);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={item.task ? `${item.task.customer.code} · ${item.task.workCategory.name}` : 'งานอื่น (ไม่ผูก Activity)'}
      footer={
        editable ? (
          <div className="flex w-full items-center justify-between gap-2">
            {canDelete ? (
              <Button
                variant="ghost"
                className="text-rose-600"
                onClick={() => {
                  onDelete();
                  onClose();
                }}
              >
                <Trash2 className="h-4 w-4" /> ลบ
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
              <Button variant="primary" disabled={!!timeError || !workDate || (custom && !title.trim())} onClick={save}>บันทึก</Button>
            </div>
          </div>
        ) : (
          <Button onClick={onClose}>ปิด</Button>
        )
      }
    >
      {item.task ? (
        <p className="-mt-1 text-[13px] text-gray-500">
          {item.task.customer.name}
          {item.task.workCategory.group ? ` · ${item.task.workCategory.group}` : ''}
          {item.assignedBy && <> · มอบหมายโดย {item.assignedBy.fullName}</>}
        </p>
      ) : (
        <>
          <p className="-mt-1 text-[13px] text-amber-700">
            จดไว้ในแผนเท่านั้น — ไม่นับในชั่วโมงประมาณการ ต้นทุน หรือภาพรวมทีม และคนอื่นไม่เห็น (ยกเว้นคนที่สร้างให้)
            {item.assignedBy && <> · มอบหมายโดย {item.assignedBy.fullName}</>}
          </p>
          <Field label="ชื่องาน">
            <input className={inputClass} maxLength={200} value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="วันที่" hint={thaiDate(workDate)}>
          <input type="date" className={inputClass} value={workDate} disabled={!editable} onChange={(e) => setWorkDate(e.target.value)} />
        </Field>
        <Field
          label={custom ? 'เวลา (ไม่บังคับ)' : 'เวลาที่วางแผน (ชม.)'}
          error={editable ? (timeError ?? undefined) : undefined}
          hint={item.actualMinutes ? `ลงเวลาจริงแล้ว ${hrs(item.actualMinutes)}` : custom ? 'เว้นว่างได้' : 'เช่น 1.5 หรือ 1:30'}
        >
          <input className={`${inputClass} tabular-nums`} inputMode="decimal" value={time} disabled={!editable} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <Field label="ความสำคัญ">
        <Segmented
          label="ความสำคัญ"
          value={priority}
          disabled={!editable}
          onChange={setPriority}
          options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY[p].label, className: `${PRIORITY[p].chip}` }))}
        />
      </Field>
      <Field label="สถานะ">
        <Segmented
          label="สถานะ"
          value={status}
          disabled={!editable}
          onChange={setStatus}
          options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS[s].label, className: `${STATUS[s].chip} ring-gray-300` }))}
        />
      </Field>
      <Field label="รายละเอียดงาน">
        <textarea className={`${inputClass} min-h-20 py-2`} maxLength={1000} value={note} disabled={!editable} placeholder="เช่น ปิดงบเดือนก.ย. ส่งภ.พ.30" onChange={(e) => setNote(e.target.value)} />
      </Field>
      {own && item.assignedBy && editable && <Alert tone="info">งานที่หัวหน้ามอบหมายลบเองไม่ได้ — ถ้าไม่ได้ทำ ให้เปลี่ยนสถานะเป็น “ยกเลิก”</Alert>}
    </Dialog>
  );
}
