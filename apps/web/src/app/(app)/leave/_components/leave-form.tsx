'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Clock3, Info, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Button, Dialog, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDate, thaiDateShort, todayBangkok } from '@/lib/format';
import { type Balance, daysText, type LeavePreview, type LeaveRequest, type LeaveUnit, type Person, personLabel, typeColor } from '@/lib/leave';
import { invalidateLeave } from './request-row';

const HOUR_CHOICES = [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480];

/**
 * File a leave request with a live calculation (working days only, balance after). HR mode adds
 * "on behalf of" and "approve now" for paper forms / sick leave reported after the fact.
 */
export function LeaveForm({ open, onClose, balances, hrMode = false }: { open: boolean; onClose: () => void; balances: Balance[]; hrMode?: boolean }) {
  const qc = useQueryClient();
  const today = todayBangkok();
  const [employeeId, setEmployeeId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [unit, setUnit] = useState<LeaveUnit>('DAYS');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [minutes, setMinutes] = useState(120);
  const [reason, setReason] = useState('');
  const [approveNow, setApproveNow] = useState(true);

  useEffect(() => {
    if (open && !typeId && balances[0]) setTypeId(balances[0].type.id);
  }, [open, typeId, balances]);

  const people = useQuery({ queryKey: ['directory'], queryFn: () => api<Person[]>('/employees/directory'), enabled: open && hrMode, staleTime: 300_000 });
  const type = balances.find((b) => b.type.id === typeId)?.type;
  const effectiveUnit: LeaveUnit = type && !type.allowHours ? 'DAYS' : unit;
  const effectiveEnd = effectiveUnit === 'HOURS' ? start : end < start ? start : end;
  const target = hrMode ? employeeId || null : null;

  const body = { employeeId: target, leaveTypeId: typeId, unit: effectiveUnit, startDate: start, endDate: effectiveEnd, minutes: effectiveUnit === 'HOURS' ? minutes : null };
  const ready = open && !!typeId && !!start && (!hrMode || !!employeeId);
  const preview = useQuery({
    queryKey: ['leave-preview', body],
    queryFn: () => api<LeavePreview>('/leave/preview', { method: 'POST', body }),
    enabled: ready,
    staleTime: 10_000,
  });

  const submit = useMutation({
    mutationFn: () => api<LeaveRequest>('/leave/requests', { method: 'POST', body: { ...body, reason, ...(hrMode ? { approve: approveNow } : {}) } }),
    onSuccess: (r) => {
      toast.success(r.status === 'APPROVED' ? 'บันทึกใบลาและอนุมัติแล้ว' : 'ส่งใบลาแล้ว — รอหัวหน้าอนุมัติ');
      invalidateLeave(qc);
      setReason('');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const p = preview.data;
  const canSubmit = ready && p?.ok && reason.trim().length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={hrMode ? 'บันทึกการลาแทนพนักงาน' : 'ยื่นใบลา'}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" disabled={!canSubmit} loading={submit.isPending} onClick={() => submit.mutate()}>
            {hrMode && approveNow ? 'บันทึกและอนุมัติ' : 'ส่งใบลา'}
          </Button>
        </>
      }
    >
      {hrMode && (
        <Field label="พนักงาน">
          <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">— เลือกพนักงาน —</option>
            {(people.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {personLabel(x)}
                {x.orgUnit ? ` (${x.orgUnit.name})` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-gray-700">ประเภทการลา</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {balances.map((b) => {
            const c = typeColor(b.type.color);
            const on = b.type.id === typeId;
            return (
              <button
                key={b.type.id}
                type="button"
                onClick={() => setTypeId(b.type.id)}
                className={`rounded-lg px-3 py-2.5 text-left ring-1 transition ring-inset ${on ? `ring-2 ${c.soft}` : 'ring-gray-200 hover:bg-gray-50'}`}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-gray-900">
                  <span className={`h-2 w-2 rounded-full ${c.dot}`} /> {b.type.name}
                </span>
                {!hrMode && <span className="mt-0.5 block text-[12px] text-gray-500">คงเหลือ {daysText(b.remainingMinutes)}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="inline-flex rounded-lg bg-gray-100 p-1" role="tablist">
        {(
          [
            ['DAYS', 'ลาเป็นวัน', CalendarDays],
            ['HOURS', 'ลาเป็นชั่วโมง', Clock3],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={effectiveUnit === k}
            disabled={k === 'HOURS' && type && !type.allowHours}
            onClick={() => setUnit(k)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium disabled:opacity-40 ${effectiveUnit === k ? 'bg-white shadow-card' : 'text-gray-500'}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={effectiveUnit === 'HOURS' ? 'วันที่' : 'ตั้งแต่วันที่'}>
          <input type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        {effectiveUnit === 'DAYS' ? (
          <Field label="ถึงวันที่">
            <input type="date" className={inputClass} min={start} value={effectiveEnd} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        ) : (
          <Field label="จำนวนชั่วโมง">
            <select className={inputClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {HOUR_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m / 60} ชม.
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {ready && preview.isFetching && !p && <p className="text-[13px] text-gray-400">กำลังคำนวณ…</p>}
      {p && !p.ok && <Alert tone="warning">{p.message}</Alert>}
      {p?.ok && (
        <div className="space-y-2 rounded-lg bg-gray-50 px-3.5 py-3 text-[13px]">
          <p className="text-gray-700">
            ใช้สิทธิ์ <b className="text-gray-900">{daysText(p.minutes)}</b>
            {effectiveUnit === 'DAYS' && p.days && p.days.length > 0 && (
              <span className="text-gray-500"> ({p.days.length} วันทำงาน: {p.days.map((d) => thaiDateShort(d.date)).join(', ')})</span>
            )}
          </p>
          {p.balances?.map((b) => (
            <p key={b.year} className="text-gray-600">
              คงเหลือปี {b.year + 543} หลังลา: <b className={b.afterMinutes != null && b.afterMinutes < 0 ? 'text-rose-600' : 'text-gray-900'}>{daysText(b.afterMinutes)}</b>
            </p>
          ))}
          {p.overQuota && (
            <p className="flex items-start gap-1.5 text-rose-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> เกินสิทธิ์ที่เหลือ — ยื่นได้ ผู้อนุมัติจะเห็นว่าเกินสิทธิ์ (ส่วนที่เกินอาจไม่ได้รับค่าจ้าง)
            </p>
          )}
          {p.needsCertificate && (
            <p className="flex items-start gap-1.5 text-amber-700">
              <Stethoscope className="mt-0.5 h-3.5 w-3.5 shrink-0" /> ลาป่วยตั้งแต่ {type?.certificateFromDays} วันทำงาน ต้องส่งใบรับรองแพทย์ให้ HR
            </p>
          )}
        </div>
      )}

      <Field label="เหตุผล">
        <textarea className={inputClass} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={hrMode ? 'เช่น ใบลากระดาษ / ป่วยแจ้งทางโทรศัพท์' : 'เช่น พาครอบครัวไปต่างจังหวัด'} />
      </Field>

      {hrMode ? (
        <label className="flex items-center gap-2 text-[13px] text-gray-700">
          <input type="checkbox" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          อนุมัติทันที (ลงบันทึกเวลาให้เลย)
        </label>
      ) : (
        <p className="flex items-start gap-1.5 text-[12px] text-gray-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> เมื่ออนุมัติแล้ว ระบบจะลงเวลาลาในบันทึกเวลาให้เอง {start && `· เริ่ม ${thaiDate(start)}`}
        </p>
      )}
    </Dialog>
  );
}
