'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarClock, Plus, Trash2, User, Users } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { hours, THAI_WEEKDAY_SHORT, thaiDateShort, todayBangkok } from '@/lib/format';

interface Schedule {
  id: string;
  name: string;
  weekdayMinutes: number[];
  assignmentCount: number;
}
interface Assignment {
  id: string;
  schedule: { id: string; name: string };
  scope: { type: 'COMPANY' | 'ORG_UNIT' | 'EMPLOYEE'; id: string | null; name: string };
  effectiveFrom: string;
  effectiveTo: string | null;
}

const SCOPE_ICON = { COMPANY: Building2, ORG_UNIT: Users, EMPLOYEE: User };
const SCOPE_LABEL = { COMPANY: 'ทั้งบริษัท', ORG_UNIT: 'ทีม', EMPLOYEE: 'รายบุคคล' };

function WeekChips({ minutes }: { minutes: number[] }) {
  return (
    <div className="flex gap-1">
      {minutes.map((m, i) => (
        <span key={i} className={`flex w-9 flex-col items-center rounded-md py-1 text-[11px] ${m ? 'bg-brand-50 text-brand-800' : 'bg-gray-50 text-gray-400'}`}>
          <span>{THAI_WEEKDAY_SHORT[i + 1]}</span>
          <span className="font-semibold tabular-nums">{m ? hours(m) : '–'}</span>
        </span>
      ))}
    </div>
  );
}

/** Effective-dated work schedules: company default, per team, per person. */
export function Schedules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['schedules'], queryFn: () => api<{ schedules: Schedule[]; assignments: Assignment[] }>('/calendar/schedules') });
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['schedules'] });
    void qc.invalidateQueries({ queryKey: ['week'] });
    void qc.invalidateQueries({ queryKey: ['month-summary'] });
  };
  const unassign = useMutation({
    mutationFn: (id: string) => api(`/calendar/schedules/assignments/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const today = todayBangkok();

  return (
    <Card
      className="mb-4"
      title={
        <span className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-brand-600" /> ตารางงาน
        </span>
      }
      description="ชั่วโมงที่ต้องกรอกในแต่ละวัน — ลำดับการใช้: รายบุคคล › ทีม › ทั้งบริษัท โดยดูตามวันที่มีผล"
      actions={
        <>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> สร้างตารางงาน
          </Button>
          <Button size="sm" variant="primary" onClick={() => setAssigning(true)}>
            กำหนดให้พนักงาน/ทีม
          </Button>
        </>
      }
      bodyClassName="p-0"
    >
      {error && <div className="p-4"><Alert tone="error">{error}</Alert></div>}
      {q.isLoading || !q.data ? (
        <div className="p-5"><Loading rows={3} /></div>
      ) : (
        <div className="grid divide-y divide-gray-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <ul className="divide-y divide-gray-100">
            {q.data.schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-[13px] font-medium text-gray-900">{s.name}</p>
                  <p className="text-[11px] text-gray-500">
                    {hours(s.weekdayMinutes.reduce((a, b) => a + b, 0))} ชม./สัปดาห์ · ใช้อยู่ {s.assignmentCount} ช่วง
                  </p>
                </div>
                <WeekChips minutes={s.weekdayMinutes} />
              </li>
            ))}
          </ul>
          <ul className="divide-y divide-gray-100">
            {q.data.assignments.map((a) => {
              const Icon = SCOPE_ICON[a.scope.type];
              const current = a.effectiveFrom <= today && (!a.effectiveTo || a.effectiveTo >= today);
              return (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                  <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-label={SCOPE_LABEL[a.scope.type]} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">
                      {a.scope.name} {current && <Badge tone="brand">ใช้อยู่</Badge>}
                    </p>
                    <p className="truncate text-[12px] text-gray-500">
                      {a.schedule.name} · {thaiDateShort(a.effectiveFrom)} {a.effectiveFrom.slice(0, 4) !== today.slice(0, 4) ? Number(a.effectiveFrom.slice(0, 4)) + 543 : ''} –{' '}
                      {a.effectiveTo ? thaiDateShort(a.effectiveTo) : 'ไม่กำหนด'}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`ลบการกำหนด ${a.scope.name}`}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => window.confirm(`ลบการกำหนดตารางงานของ ${a.scope.name}?`) && unassign.mutate(a.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <CreateScheduleDialog open={creating} onClose={() => setCreating(false)} onDone={refresh} />
      {q.data && <AssignDialog open={assigning} onClose={() => setAssigning(false)} onDone={refresh} schedules={q.data.schedules} />}
    </Card>
  );
}

function CreateScheduleDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [hrs, setHrs] = useState(['9', '9', '9', '9', '9', '0', '0']);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api('/calendar/schedules', { method: 'POST', body: { name, weekdayMinutes: hrs.map((h) => Math.round(Number(h || 0) * 60)) } }),
    onSuccess: () => {
      onDone();
      onClose();
      setName('');
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="สร้างตารางงาน"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>บันทึก</Button>
        </>
      }
    >
      <Field label="ชื่อตารางงาน">
        <input className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="เช่น 8 ชม. จันทร์–ศุกร์" />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-gray-700">ชั่วโมงต่อวัน</legend>
        <div className="grid grid-cols-7 gap-1.5">
          {hrs.map((h, i) => (
            <label key={i} className="text-center">
              <span className="mb-1 block text-[11px] text-gray-500">{THAI_WEEKDAY_SHORT[i + 1]}</span>
              <input
                className={`${inputClass} px-1 text-center`}
                inputMode="decimal"
                value={h}
                onChange={(e) => setHrs(hrs.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`ชั่วโมงวัน${THAI_WEEKDAY_SHORT[i + 1]}`}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-[12px] text-gray-500">แก้ไขตารางงานที่ใช้อยู่จะกระทบช่วงเวลาที่ผ่านมาด้วย — ถ้าจะเปลี่ยนกติกาจากนี้ไป ให้สร้างตารางใหม่แล้วกำหนดวันเริ่มมีผล</p>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

function AssignDialog({ open, onClose, onDone, schedules }: { open: boolean; onClose: () => void; onDone: () => void; schedules: Schedule[] }) {
  const [scope, setScope] = useState<'COMPANY' | 'ORG_UNIT' | 'EMPLOYEE'>('EMPLOYEE');
  const [target, setTarget] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [from, setFrom] = useState(todayBangkok());
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options = useQuery({
    queryKey: ['employee-options'],
    queryFn: () => api<{ orgUnits: { id: string; name: string }[] }>('/employees/options'),
    enabled: open,
  });
  const people = useQuery({ queryKey: ['admin-employees'], queryFn: () => api<{ id: string; fullName: string; status: string }[]>('/employees'), enabled: open });
  const save = useMutation({
    mutationFn: () =>
      api('/calendar/schedules/assignments', {
        method: 'POST',
        body: {
          scheduleId,
          employeeId: scope === 'EMPLOYEE' ? target : null,
          orgUnitId: scope === 'ORG_UNIT' ? target : null,
          effectiveFrom: from,
          effectiveTo: to || null,
        },
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const valid = scheduleId && from && (scope === 'COMPANY' || target);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="กำหนดตารางงาน"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>บันทึก</Button>
        </>
      }
    >
      <Field label="ใช้กับ">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1" role="radiogroup">
          {(['EMPLOYEE', 'ORG_UNIT', 'COMPANY'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scope === s}
              onClick={() => {
                setScope(s);
                setTarget('');
              }}
              className={`h-8 rounded-md text-[13px] font-medium ${scope === s ? 'bg-white shadow-card' : 'text-gray-500'}`}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
      </Field>
      {scope !== 'COMPANY' && (
        <Field label={scope === 'EMPLOYEE' ? 'พนักงาน' : 'ทีม'}>
          <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">— เลือก —</option>
            {(scope === 'EMPLOYEE' ? (people.data ?? []).filter((p) => p.status === 'ACTIVE').map((p) => ({ id: p.id, name: p.fullName })) : (options.data?.orgUnits ?? [])).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="ตารางงาน">
        <select className={inputClass} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
          <option value="">— เลือก —</option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="มีผลตั้งแต่">
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึง (ไม่บังคับ)">
          <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <p className="text-[12px] text-gray-500">ถ้าขอบเขตเดียวกันมีตารางที่ไม่มีวันสิ้นสุดอยู่ ระบบจะปิดของเดิมให้ในวันก่อนหน้าโดยอัตโนมัติ</p>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}
