'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, CircleSlash, Laptop, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { AssetRow, AssetSummary } from '@/lib/assets';
import { thaiDate, thaiDateShort } from '@/lib/format';
import { type Task, TASK_STATUS_LABEL, type TaskStatus } from '@/lib/onboarding';
import { can, useSession } from '@/lib/session';

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  TODO: <Circle className="h-4 w-4 text-gray-300" />,
  DONE: <CheckCircle2 className="h-4 w-4 text-brand-600" />,
  SKIPPED: <CircleSlash className="h-4 w-4 text-amber-500" />,
  NOT_APPLICABLE: <CircleSlash className="h-4 w-4 text-gray-400" />,
};

/** One checklist line with its action dialog. Used on the employee page and the IT/Admin queue. */
export function TaskRow({ task, overdue, onChanged, extra }: { task: Task; overdue?: boolean; onChanged: () => void; extra?: React.ReactNode }) {
  const me = useSession();
  const [open, setOpen] = useState(false);
  const canAct = can(me, 'onboarding.manage');
  const done = task.status !== 'TODO';
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5">{STATUS_ICON[task.status]}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] ${done ? 'text-gray-500' : 'font-medium text-gray-900'}`}>{task.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
          {extra}
          {task.status === 'TODO' ? (
            <span className={overdue ? 'font-medium text-rose-600' : ''}>กำหนด {thaiDateShort(task.dueDate)}{overdue && ' · เลยกำหนด'}</span>
          ) : (
            <span>{TASK_STATUS_LABEL[task.status]}{task.doneBy && ` โดย ${task.doneBy}`}{task.doneAt && ` · ${thaiDate(task.doneAt.slice(0, 10))}`}</span>
          )}
          {task.account && <Badge tone="sky">{task.system?.identifierLabel}: {task.account.identifier}</Badge>}
          {task.assetCode && <Badge tone="sky"><Laptop className="h-3 w-3" /> {task.assetCode}</Badge>}
          {task.note && <span className="text-gray-600">“{task.note}”</span>}
        </p>
      </div>
      {canAct && (
        <Button size="sm" variant={done ? 'ghost' : 'secondary'} onClick={() => setOpen(true)}>
          {done ? <RotateCcw className="h-3.5 w-3.5" /> : 'ทำรายการ'}
        </Button>
      )}
      {open && <TaskDialog task={task} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChanged(); }} />}
    </li>
  );
}

function TaskDialog({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: () => void }) {
  const me = useSession();
  const [identifier, setIdentifier] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [assignKind, setAssignKind] = useState<'PRIMARY' | 'LOAN'>('PRIMARY');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState(task.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const needsAccount = !!task.system && !task.account;
  const needsDevice = task.requiresAsset && !task.assetCode;
  const spare = useQuery({
    queryKey: ['assets', 'spare'],
    queryFn: () => api<{ summary: AssetSummary; rows: AssetRow[] }>('/assets', { query: { state: 'AVAILABLE' } }),
    enabled: needsDevice && can(me, 'asset.read'),
  });
  const save = useMutation({
    mutationFn: (status: TaskStatus) =>
      api(`/onboarding/tasks/${task.id}`, {
        method: 'POST',
        body: {
          status,
          note: note || null,
          ...(status === 'DONE' && needsAccount ? { identifier } : {}),
          ...(status === 'DONE' && needsDevice ? { assetCode, assignKind, dueDate: assignKind === 'LOAN' ? dueDate : null } : {}),
        },
      }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  const reopen = task.status !== 'TODO';
  const doneReady = (!needsAccount || identifier.trim()) && (!needsDevice || (assetCode && (assignKind === 'PRIMARY' || dueDate)));

  return (
    <Dialog
      open
      onClose={onClose}
      title={task.title}
      footer={
        reopen ? (
          <>
            <Button variant="ghost" onClick={onClose}>ปิด</Button>
            <Button loading={save.isPending} onClick={() => save.mutate('TODO')}><RotateCcw className="h-4 w-4" /> เปิดงานใหม่</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => save.mutate('NOT_APPLICABLE')} disabled={save.isPending}>ไม่เกี่ยวข้อง</Button>
            <Button variant="ghost" onClick={() => save.mutate('SKIPPED')} disabled={save.isPending || !note.trim()} title="ต้องระบุเหตุผลในหมายเหตุ">ข้าม</Button>
            <Button variant="primary" loading={save.isPending} disabled={!doneReady} onClick={() => save.mutate('DONE')}>เสร็จแล้ว</Button>
          </>
        )
      }
    >
      {task.description && <p className="text-[13px] text-gray-600">{task.description}</p>}
      {reopen ? (
        <p className="text-[13px] text-gray-600">
          สถานะ: {TASK_STATUS_LABEL[task.status]} — เปิดงานใหม่จะไม่ลบบัญชีหรือการมอบเครื่องที่บันทึกไว้แล้ว
        </p>
      ) : (
        <>
          {needsAccount && (
            <Field label={`${task.system!.identifierLabel} ใน ${task.system!.name}`} hint="บันทึกเฉพาะชื่อบัญชี — ห้ามใส่รหัสผ่าน">
              <input autoFocus className={inputClass} value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            </Field>
          )}
          {needsDevice && (
            <div className="space-y-3">
              <Field label="เครื่องที่มอบ">
                <select className={inputClass} value={assetCode} onChange={(e) => setAssetCode(e.target.value)}>
                  <option value="">— เลือกเครื่องสำรอง —</option>
                  {spare.data?.rows.map((a) => (
                    <option key={a.id} value={a.code}>{a.code} · {[a.brand, a.model].filter(Boolean).join(' ') || a.category.name}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="ลักษณะ">
                  <select className={inputClass} value={assignKind} onChange={(e) => setAssignKind(e.target.value as 'PRIMARY' | 'LOAN')}>
                    <option value="PRIMARY">ใช้ประจำ</option>
                    <option value="LOAN">ยืมชั่วคราว</option>
                  </select>
                </Field>
                {assignKind === 'LOAN' && <Field label="กำหนดคืน"><input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
              </div>
              <p className="text-[12px] text-gray-500">นำเครื่องมาเอง → กด “ไม่เกี่ยวข้อง”</p>
            </div>
          )}
          <Field label="หมายเหตุ"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ถ้า “ข้าม” ต้องระบุเหตุผล" /></Field>
        </>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}
