'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CalendarX2, Pencil, Plus, RefreshCw, Scale } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDateShort, todayBangkok } from '@/lib/format';
import { type Balance, DAY_MINUTES, daysText, type LeaveRequest, type LeaveStatus, type LeaveType, personLabel, STATUS_LABEL, typeColor } from '@/lib/leave';
import type { SyncStatus } from '@/lib/rooms';
import { Optional } from '@/components/optional';
import { invalidateLeave, RequestRow } from './request-row';

type Sub = 'requests' | 'entitlements' | 'types';

export function HrAdmin({ onRecord }: { onRecord: () => void }) {
  const [sub, setSub] = useState<Sub>('requests');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex rounded-lg bg-gray-100 p-1">
          {(
            [
              ['requests', 'ใบลาทั้งหมด'],
              ['entitlements', 'สิทธิ์วันลารายคน'],
              ['types', 'ประเภทการลา'],
            ] as [Sub, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" type="button" aria-selected={sub === k} onClick={() => setSub(k)} className={`h-8 rounded-md px-3 text-[13px] font-medium ${sub === k ? 'bg-white shadow-card' : 'text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={onRecord}>
          <Plus className="h-4 w-4" /> บันทึกการลาแทนพนักงาน
        </Button>
      </div>
      {sub === 'requests' && <AllRequests />}
      {sub === 'entitlements' && <Entitlements />}
      {sub === 'types' && <Types />}
      <Optional name="calendar-sync">
        <CalendarSyncCard />
      </Optional>
    </div>
  );
}

function AllRequests() {
  const [status, setStatus] = useState<LeaveStatus | ''>('PENDING');
  const [year, setYear] = useState(Number(todayBangkok().slice(0, 4)));
  const q = useQuery({ queryKey: ['leave-all', status, year], queryFn: () => api<LeaveRequest[]>('/leave/requests', { query: { status: status || undefined, year } }) });
  return (
    <Card
      title="ใบลาทั้งหมด"
      actions={
        <>
          <div className="w-36">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as LeaveStatus | '')}>
              <option value="">ทุกสถานะ</option>
              {(Object.keys(STATUS_LABEL) as LeaveStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <YearSelect year={year} onChange={setYear} />
        </>
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <div className="p-5">
          <Loading rows={4} />
        </div>
      ) : q.data?.length ? (
        <ul className="divide-y divide-gray-100">
          {q.data.map((r) => (
            <RequestRow key={r.id} r={r} mode="hr" />
          ))}
        </ul>
      ) : (
        <Empty icon={<CalendarCheck2 className="h-5 w-5" />} title="ไม่มีใบลาตามเงื่อนไขนี้" />
      )}
    </Card>
  );
}

function YearSelect({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  const now = Number(todayBangkok().slice(0, 4));
  return (
    <div className="w-28">
      <select className={inputClass} value={year} onChange={(e) => onChange(Number(e.target.value))}>
        {[now + 1, now, now - 1, now - 2].map((y) => (
          <option key={y} value={y}>
            ปี {y + 543}
          </option>
        ))}
      </select>
    </div>
  );
}

interface EntitlementRow {
  employee: { id: string; fullName: string; nickname: string | null; code: string | null; team: string | null; employmentType: string; startDate: string | null };
  balances: Balance[];
}

function Entitlements() {
  const [year, setYear] = useState(Number(todayBangkok().slice(0, 4)));
  const [editing, setEditing] = useState<{ row: EntitlementRow; balance: Balance } | null>(null);
  const q = useQuery({ queryKey: ['leave-entitlements', year], queryFn: () => api<{ year: number; rows: EntitlementRow[] }>('/leave/entitlements', { query: { year } }) });
  const types = q.data?.rows[0]?.balances.map((b) => b.type) ?? [];
  return (
    <Card
      title="สิทธิ์วันลารายคน"
      description="ค่าตั้งต้นตามกฎหมาย (พักร้อน 6 วันหลังทำงานครบ 1 ปี, ลากิจ 3 วัน, ลาป่วย 30 วัน) — คลิกตัวเลขเพื่อปรับรายคน"
      actions={<YearSelect year={year} onChange={setYear} />}
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <div className="p-5">
          <Loading rows={6} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[13px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[12px] text-gray-500">
                <th className="px-4 py-2 font-medium">พนักงาน</th>
                {types.map((t) => (
                  <th key={t.id} className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${typeColor(t.color).dot}`} /> {t.name}
                    </span>
                    <span className="block font-normal text-gray-400">คงเหลือ / สิทธิ์</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {q.data?.rows.map((row) => (
                <tr key={row.employee.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">{personLabel(row.employee)}</div>
                    <div className="text-[12px] text-gray-400">
                      {[row.employee.code, row.employee.team, row.employee.startDate && `เริ่มงาน ${thaiDateShort(row.employee.startDate)} ${Number(row.employee.startDate.slice(0, 4)) + 543}`].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  {row.balances.map((b) => (
                    <td key={b.type.id} className="px-3 py-2">
                      <button type="button" onClick={() => setEditing({ row, balance: b })} className="group rounded-md px-1.5 py-1 text-left hover:bg-brand-50">
                        <span className={`font-medium ${b.remainingMinutes != null && b.remainingMinutes < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{daysText(b.remainingMinutes)}</span>
                        <span className="text-gray-400"> / {daysText(b.entitledMinutes)}</span>
                        {b.overridden && (
                          <Badge tone="brand">
                            <Scale className="h-3 w-3" /> ปรับ
                          </Badge>
                        )}
                        <Pencil className="ml-1 inline h-3 w-3 text-gray-300 group-hover:text-brand-500" />
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EntitlementDialog key={`${editing.row.employee.id}-${editing.balance.type.id}`} year={year} {...editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function EntitlementDialog({ row, balance, year, onClose }: { row: EntitlementRow; balance: Balance; year: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(balance.entitledMinutes == null ? '' : String(balance.entitledMinutes / DAY_MINUTES));
  const [note, setNote] = useState(balance.note ?? '');
  const save = useMutation({
    mutationFn: (minutes: number | null) => api('/leave/entitlements', { method: 'PUT', body: { employeeId: row.employee.id, leaveTypeId: balance.type.id, year, minutes, note: note || null } }),
    onSuccess: () => {
      toast.success('บันทึกสิทธิ์แล้ว');
      invalidateLeave(qc);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const value = Number(days);
  const valid = days !== '' && Number.isFinite(value) && value >= 0 && value <= 366 && (value * 2) % 1 === 0;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${balance.type.name} ปี ${year + 543} — ${personLabel(row.employee)}`}
      footer={
        <>
          {balance.overridden && (
            <Button variant="ghost" className="mr-auto" loading={save.isPending && save.variables === null} onClick={() => save.mutate(null)}>
              กลับไปใช้ค่าตั้งต้น
            </Button>
          )}
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending && save.variables !== null} onClick={() => save.mutate(Math.round(value * DAY_MINUTES))}>
            บันทึก
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-gray-600">
        ใช้ไปแล้ว {daysText(balance.usedMinutes)}
        {balance.pendingMinutes > 0 && ` · รออนุมัติ ${daysText(balance.pendingMinutes)}`}
      </p>
      <Field label="สิทธิ์ทั้งปี (วัน)" hint="ปรับได้ทีละครึ่งวัน เช่น 8 หรือ 7.5 (1 วัน = 9 ชม.)">
        <input type="number" min={0} max={366} step={0.5} className={inputClass} value={days} onChange={(e) => setDays(e.target.value)} />
      </Field>
      <Field label="หมายเหตุ / ที่มา">
        <input className={inputClass} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น อายุงาน 5 ปี ได้เพิ่มตามนโยบายบริษัท" />
      </Field>
    </Dialog>
  );
}

function Types() {
  const q = useQuery({ queryKey: ['leave-types-all'], queryFn: () => api<LeaveType[]>('/leave/types', { query: { all: 1 } }) });
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  return (
    <Card
      title="ประเภทการลา"
      description="แต่ละประเภทผูกกับ Activity การลาในบันทึกเวลา (เดิม ลากิจ 34 / ลาป่วย 35 / ลาพักร้อน 36)"
      actions={
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-3.5 w-3.5" /> เพิ่มประเภท
        </Button>
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <div className="p-5">
          <Loading rows={3} />
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {q.data?.map((t) => (
            <li key={t.id} className={`flex items-start gap-3 px-4 py-3 ${t.isActive ? '' : 'opacity-60'}`}>
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${typeColor(t.color).dot}`} />
              <div className="min-w-0 flex-1 text-[13px]">
                <p className="font-medium text-gray-900">
                  {t.name} <span className="font-normal text-gray-400">({t.key})</span> {!t.isActive && <Badge>ปิดใช้งาน</Badge>}
                </p>
                <p className="text-gray-600">
                  สิทธิ์ {t.annualDays == null ? 'ไม่จำกัด' : `${t.annualDays} วัน/ปี`}
                  {t.minTenureMonths > 0 && ` · หลังทำงาน ${t.minTenureMonths} เดือน`}
                  {` · ${t.paid ? 'ได้รับค่าจ้าง' : 'ไม่ได้รับค่าจ้าง'}`}
                  {t.allowHours ? ' · ลาเป็นชั่วโมงได้' : ' · ลาเป็นวันเท่านั้น'}
                  {t.certificateFromDays && ` · ใบรับรองแพทย์ตั้งแต่ ${t.certificateFromDays} วัน`}
                </p>
                {t.source && <p className="text-[12px] text-gray-400">{t.source}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                <Pencil className="h-3.5 w-3.5" /> แก้ไข
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <TypeDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

const COLORS = ['sky', 'amber', 'rose', 'emerald', 'violet', 'indigo', 'gray'];

function TypeDialog({ type, onClose }: { type: LeaveType | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    key: type?.key ?? '',
    name: type?.name ?? '',
    days: type?.annualDays == null ? '' : String(type.annualDays),
    minTenureMonths: type?.minTenureMonths ?? 0,
    paid: type?.paid ?? true,
    allowHours: type?.allowHours ?? false,
    certificateFromDays: type?.certificateFromDays == null ? '' : String(type.certificateFromDays),
    color: type?.color ?? 'violet',
    source: type?.source ?? '',
    isActive: type?.isActive ?? true,
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        annualMinutes: f.days === '' ? null : Math.round(Number(f.days) * DAY_MINUTES),
        minTenureMonths: Number(f.minTenureMonths),
        paid: f.paid,
        allowHours: f.allowHours,
        certificateFromDays: f.certificateFromDays === '' ? null : Number(f.certificateFromDays),
        appliesTo: type?.appliesTo ?? [],
        color: f.color,
        source: f.source || null,
      };
      return type ? api(`/leave/types/${type.id}`, { method: 'PATCH', body: { ...body, isActive: f.isActive } }) : api('/leave/types', { method: 'POST', body: { ...body, key: f.key } });
    },
    onSuccess: () => {
      toast.success('บันทึกประเภทการลาแล้ว');
      void qc.invalidateQueries({ queryKey: ['leave-types-all'] });
      invalidateLeave(qc);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={type ? `แก้ไข ${type.name}` : 'เพิ่มประเภทการลา'}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" disabled={!f.name.trim() || (!type && !f.key)} loading={save.isPending} onClick={() => save.mutate()}>
            บันทึก
          </Button>
        </>
      }
    >
      {!type && (
        <Alert tone="info">ระบบจะสร้าง Activity การลาใหม่ในบันทึกเวลาให้อัตโนมัติ เช่น ลาคลอด (98 วัน ตามกฎหมาย ม.41), ลาบวช, ลาไม่รับค่าจ้าง</Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {!type && (
          <Field label="รหัส (อังกฤษตัวใหญ่)">
            <input className={inputClass} value={f.key} onChange={(e) => set({ key: e.target.value.toUpperCase() })} placeholder="MATERNITY" />
          </Field>
        )}
        <Field label="ชื่อ">
          <input className={inputClass} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="ลาคลอด" />
        </Field>
        <Field label="สิทธิ์ต่อปี (วัน)" hint="เว้นว่าง = ไม่จำกัด (บันทึกอย่างเดียว)">
          <input type="number" min={0} step={0.5} className={inputClass} value={f.days} onChange={(e) => set({ days: e.target.value })} />
        </Field>
        <Field label="ต้องทำงานมาแล้ว (เดือน)">
          <input type="number" min={0} max={120} className={inputClass} value={f.minTenureMonths} onChange={(e) => set({ minTenureMonths: Number(e.target.value) })} />
        </Field>
        <Field label="ขอใบรับรองแพทย์ตั้งแต่ (วันทำงาน)" hint="เว้นว่าง = ไม่ต้อง">
          <input type="number" min={1} max={60} className={inputClass} value={f.certificateFromDays} onChange={(e) => set({ certificateFromDays: e.target.value })} />
        </Field>
        <Field label="สี">
          <div className="flex gap-1.5 pt-1.5">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => set({ color: c })} className={`h-6 w-6 rounded-full ${typeColor(c).dot} ${f.color === c ? 'ring-2 ring-gray-900 ring-offset-2' : ''}`} />
            ))}
          </div>
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-[13px] text-gray-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.paid} onChange={(e) => set({ paid: e.target.checked })} className="h-4 w-4 rounded border-gray-300" /> ได้รับค่าจ้าง
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.allowHours} onChange={(e) => set({ allowHours: e.target.checked })} className="h-4 w-4 rounded border-gray-300" /> ลาเป็นชั่วโมงได้
        </label>
        {type && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="h-4 w-4 rounded border-gray-300" /> เปิดใช้งาน
          </label>
        )}
      </div>
      <Field label="ที่มาของกฎ" hint="เช่น [กฎหมาย] ม.41 / [นโยบายบริษัท] ประกาศ 1/2569">
        <input className={inputClass} maxLength={300} value={f.source} onChange={(e) => set({ source: e.target.value })} />
      </Field>
    </Dialog>
  );
}

/** Google Calendar connection — shared by HR (leave) and room admins. */
export function CalendarSyncCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['calendar-sync'], queryFn: () => api<SyncStatus>('/rooms/calendar-sync'), staleTime: 30_000 });
  const run = useMutation({
    mutationFn: () => api<{ configured: boolean; synced: number; failed: number }>('/rooms/calendar-sync/run', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(r.configured ? `ส่งเข้า Google Calendar ${r.synced} รายการ${r.failed ? `, ไม่สำเร็จ ${r.failed}` : ''}` : 'ยังไม่ได้เชื่อม Google Calendar');
      void qc.invalidateQueries({ queryKey: ['calendar-sync'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = q.data;
  if (!s) return null;
  return (
    <Card
      title="Google Calendar"
      description={
        s.configured
          ? `เชื่อมต่อแล้ว — การจองห้องและวันลาที่อนุมัติจะขึ้นในปฏิทินของแต่ละคนและแจ้งเตือนบนมือถือ${s.companyCalendar ? ' · ลงปฏิทินบริษัทด้วย' : ''}`
          : 'ยังไม่ได้เชื่อม — เมื่อบริษัทเปิด Google Workspace ให้ตั้งค่า Service Account แล้วรายการที่ค้างจะถูกส่งเข้าไปเอง'
      }
      actions={
        s.configured && (
          <Button size="sm" loading={run.isPending} onClick={() => run.mutate()}>
            <RefreshCw className="h-3.5 w-3.5" /> ส่งตอนนี้
          </Button>
        )
      }
    >
      <div className="flex flex-wrap gap-2 text-[13px]">
        <Badge tone={s.configured ? 'brand' : 'gray'}>{s.configured ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}</Badge>
        <Badge tone="amber">รอส่ง {s.pending}</Badge>
        <Badge tone="sky">ส่งแล้ว {s.done}</Badge>
        {s.failed > 0 && (
          <Badge tone="rose">
            <CalendarX2 className="h-3 w-3" /> ไม่สำเร็จ {s.failed}
          </Badge>
        )}
      </div>
      {s.lastFailure?.lastError && <p className="mt-2 text-[12px] text-rose-600">ล่าสุด: {s.lastFailure.lastError}</p>}
    </Card>
  );
}
