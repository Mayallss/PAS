'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, FileHeart, Stethoscope, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Dialog, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDateShort } from '@/lib/format';
import { daysText, type LeaveRequest, personLabel, rangeLabel, STATUS_LABEL, STATUS_TONE, typeColor } from '@/lib/leave';

export function invalidateLeave(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['leave-me', 'leave-approvals', 'leave-calendar', 'leave-all', 'leave-entitlements', 'notifications']) void qc.invalidateQueries({ queryKey: [key] });
}

/**
 * One request. `mode` decides what is shown and which actions exist:
 *  mine      — own request: cancel while allowed
 *  approver  — team lead / HR queue: approve, reject (reason required)
 *  hr        — HR list: certificate received, cancel any
 */
export function RequestRow({ r, mode }: { r: LeaveRequest; mode: 'mine' | 'approver' | 'hr' }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'reject' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const c = typeColor(r.type.color);

  const done = (msg: string) => {
    toast.success(msg);
    setDialog(null);
    setNote('');
    invalidateLeave(qc);
  };
  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') => api<LeaveRequest>(`/leave/requests/${r.id}/decision`, { method: 'POST', body: { decision, note: note || null, expectedVersion: r.version } }),
    onSuccess: (_, decision) => done(decision === 'APPROVE' ? 'อนุมัติแล้ว — ลงบันทึกเวลาให้แล้ว' : 'ไม่อนุมัติแล้ว'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api<LeaveRequest>(`/leave/requests/${r.id}/cancel`, { method: 'POST', body: { reason: note || null, expectedVersion: r.version } }),
    onSuccess: () => done('ยกเลิกใบลาแล้ว'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const document = useMutation({
    mutationFn: (received: boolean) => api<LeaveRequest>(`/leave/requests/${r.id}/document`, { method: 'POST', body: { received } }),
    onSuccess: () => invalidateLeave(qc),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const canCancel = mode === 'mine' ? r.canCancel : mode === 'hr' && (r.status === 'PENDING' || r.status === 'APPROVED');

  return (
    <li className={`flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start ${r.status === 'CANCELLED' || r.status === 'REJECTED' ? 'opacity-70' : ''}`}>
      <span className={`mt-1 hidden h-9 w-1 shrink-0 rounded-full sm:block ${c.bar}`} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {mode !== 'mine' && <span className="font-medium text-gray-900">{personLabel(r.employee)}</span>}
          <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] font-medium ring-1 ring-inset ${c.soft} ${c.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
            {r.type.name}
          </span>
          <span className="text-[13px] font-medium text-gray-900">{rangeLabel(r.startDate, r.endDate, thaiDateShort)}</span>
          <span className="text-[13px] text-gray-500">· {daysText(r.minutes)}</span>
          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          {r.overQuota && r.status !== 'CANCELLED' && (
            <Badge tone="rose">
              <AlertTriangle className="h-3 w-3" /> เกินสิทธิ์
            </Badge>
          )}
          {r.noTeamApprover && mode === 'approver' && <Badge tone="sky">ไม่มีหัวหน้าทีม — HR พิจารณา</Badge>}
        </div>
        <p className="text-[13px] break-words text-gray-600">{r.reason}</p>
        <p className="text-[12px] text-gray-400">
          {r.employee.team && mode !== 'mine' ? `${r.employee.team} · ` : ''}
          ยื่นเมื่อ {thaiDateShort(r.createdAt.slice(0, 10))}
          {r.filedBy && ` · บันทึกโดย ${r.filedBy}`}
          {r.decidedBy && ` · ${r.status === 'REJECTED' ? 'ไม่อนุมัติโดย' : 'อนุมัติโดย'} ${r.decidedBy}`}
          {r.decisionNote && ` — “${r.decisionNote}”`}
          {r.cancelledBy && ` · ยกเลิกโดย ${r.cancelledBy}${r.cancelReason ? ` — “${r.cancelReason}”` : ''}`}
        </p>
        {mode === 'approver' && r.balance && (
          <p className="text-[12px] text-gray-500">
            {/* remaining already deducts every pending request, this one included */}
            ถ้าอนุมัติ สิทธิ์{r.type.name}จะเหลือ{' '}
            <b className={r.balance.remainingMinutes != null && r.balance.remainingMinutes < 0 ? 'text-rose-600' : 'text-gray-800'}>{daysText(r.balance.remainingMinutes)}</b>
            {r.balance.entitledMinutes != null && ` จาก ${daysText(r.balance.entitledMinutes)}`}
          </p>
        )}
        {r.needsCertificate && r.status !== 'CANCELLED' && r.status !== 'REJECTED' && (
          <p className={`inline-flex items-center gap-1.5 text-[12px] ${r.documentReceived ? 'text-emerald-700' : 'text-amber-700'}`}>
            <Stethoscope className="h-3.5 w-3.5" />
            {r.documentReceived ? 'HR ได้รับใบรับรองแพทย์แล้ว' : 'ต้องส่งใบรับรองแพทย์ให้ HR'}
            {mode === 'hr' && (
              <button type="button" className="ml-1 font-medium text-brand-600 underline-offset-2 hover:underline" onClick={() => document.mutate(!r.documentReceived)}>
                {r.documentReceived ? 'ยกเลิก' : 'ได้รับแล้ว'}
              </button>
            )}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {mode === 'approver' && r.status === 'PENDING' && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setDialog('reject')}>
              <X className="h-3.5 w-3.5" /> ไม่อนุมัติ
            </Button>
            <Button size="sm" variant="primary" loading={decide.isPending && decide.variables === 'APPROVE'} onClick={() => decide.mutate('APPROVE')}>
              <Check className="h-3.5 w-3.5" /> อนุมัติ
            </Button>
          </>
        )}
        {canCancel && (
          <Button size="sm" variant="ghost" onClick={() => setDialog('cancel')}>
            ยกเลิกใบลา
          </Button>
        )}
      </div>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'reject' ? 'ไม่อนุมัติใบลา' : 'ยกเลิกใบลา'}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>ปิด</Button>
            {dialog === 'reject' ? (
              <Button variant="danger" disabled={!note.trim()} loading={decide.isPending} onClick={() => decide.mutate('REJECT')}>
                ยืนยันไม่อนุมัติ
              </Button>
            ) : (
              <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                ยืนยันยกเลิก
              </Button>
            )}
          </>
        }
      >
        <p className="flex items-start gap-2 text-[13px] text-gray-600">
          <FileHeart className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          {r.type.name} {rangeLabel(r.startDate, r.endDate, thaiDateShort)} ({daysText(r.minutes)})
          {dialog === 'cancel' && r.status === 'APPROVED' && ' — รายการลาในบันทึกเวลาจะถูกลบออกด้วย'}
        </p>
        <Field label={dialog === 'reject' ? 'เหตุผล (แจ้งผู้ลา)' : 'เหตุผล (ไม่บังคับ)'}>
          <textarea className={inputClass} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
      </Dialog>
    </li>
  );
}
