'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Laptop, ListChecks, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { KIND_LABEL } from '@/lib/assets';
import { thaiDate } from '@/lib/format';
import { ACCOUNT_STATUS_LABEL, EMPLOYMENT_LABEL, type EmployeeProfile, type EmploymentType, type OnboardingOptions } from '@/lib/onboarding';
import { can, useSession } from '@/lib/session';
import { TaskRow } from '../../onboarding/_components/task-row';
import { SignInCard } from './sign-in-card';

export default function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => api<EmployeeProfile>(`/employees/${id}`) });
  const options = useQuery({ queryKey: ['onboarding-options'], queryFn: () => api<OnboardingOptions>('/onboarding/options') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['employee', id] });
    void qc.invalidateQueries({ queryKey: ['onboarding-tasks'] });
    void qc.invalidateQueries({ queryKey: ['admin-employees'] });
  };
  const manage = can(me, 'onboarding.manage');

  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const e = q.data;
  const current = e.devices.filter((d) => !d.endDate);
  const past = e.devices.filter((d) => d.endDate);

  return (
    <div>
      <Link href="/admin/employees" className="mb-3 inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> พนักงานและสิทธิ์
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{e.fullName}</h1>
            {e.nickname && <span className="text-lg text-gray-500">({e.nickname})</span>}
            {e.status === 'ACTIVE' ? <Badge tone="brand">ทำงาน</Badge> : <Badge>พ้นสภาพ</Badge>}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {e.employeeCode && <span className="font-mono">{e.employeeCode} · </span>}
            {EMPLOYMENT_LABEL[e.employmentType]}
            {e.department && <> · {e.department.name}</>}
            {e.orgUnit && <> · {e.orgUnit.name}</>}
            {e.level && <> · {e.level.name}</>}
          </p>
        </div>
        {can(me, 'employee.admin') && (
          <Button onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> แก้ไขข้อมูล</Button>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {e.cases.map((c) => {
            const left = c.tasks.filter((t) => t.status === 'TODO').length;
            return (
              <Card
                key={c.id}
                title={<span className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-brand-600" /> {c.kind === 'ONBOARDING' ? 'Checklist รับพนักงานใหม่' : 'Checklist พนักงานออก'}</span>}
                description={`เปิดเมื่อ ${thaiDate(c.openedOn)}${c.closedOn ? ` · ปิดเมื่อ ${thaiDate(c.closedOn)}` : ''}`}
                actions={c.closedOn ? <Badge tone="brand">ครบแล้ว</Badge> : <Badge tone="amber">เหลือ {left} ข้อ</Badge>}
                bodyClassName="px-5 py-1"
              >
                <ul className="divide-y divide-gray-100">
                  {c.tasks.map((t) => <TaskRow key={t.id} task={t} overdue={t.status === 'TODO' && t.dueDate < new Date().toISOString().slice(0, 10)} onChanged={refresh} />)}
                </ul>
              </Card>
            );
          })}

          <Card
            title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-600" /> บัญชีในระบบอื่น</span>}
            description="เก็บเฉพาะชื่อบัญชีและสถานะ — รหัสผ่านไม่เก็บในระบบนี้"
            actions={manage && <Button size="sm" variant="ghost" onClick={() => setAddingAccount(true)}><Plus className="h-3.5 w-3.5" /> เพิ่มบัญชี</Button>}
            bodyClassName="p-0"
          >
            {!e.accounts.length ? (
              <p className="px-5 py-4 text-[13px] text-gray-500">ยังไม่มีบัญชี</p>
            ) : (
              <table className="min-w-full text-[13px]">
                <tbody>
                  {e.accounts.map((a) => (
                    <AccountRow key={a.id} account={a} canEdit={manage} onChanged={refresh} />
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {can(me, 'employee.admin') && <SignInCard employeeId={e.id} active={e.status === 'ACTIVE'} />}
          <Card title="ข้อมูลติดต่อ" bodyClassName="px-5 py-3">
            <dl className="divide-y divide-gray-100 text-[13px]">
              {[
                ['อีเมลบริษัท (เข้าระบบ)', e.email ?? <span className="text-amber-700">ยังไม่มี</span>],
                ...(e.personalEmail !== undefined ? [['อีเมลส่วนตัว', e.personalEmail]] : []),
                ['Name', e.fullNameEn],
                ['เริ่มงาน', e.startDate && thaiDate(e.startDate)],
                ['สิ้นสุด', e.endDate && thaiDate(e.endDate)],
                ...(e.employmentType === 'INTERN' ? [['สถาบัน', e.institution]] : []),
              ].map(([k, v], i) => (
                <div key={i} className="flex justify-between gap-3 py-1.5">
                  <dt className="shrink-0 text-gray-500">{k}</dt>
                  <dd className="min-w-0 truncate text-right text-gray-900">{v || '–'}</dd>
                </div>
              ))}
            </dl>
            {!!e.levelHistory?.length && (
              <div className="mt-2 border-t border-gray-100 pt-2">
                <p className="mb-1 text-[12px] font-medium text-gray-500">ประวัติระดับ</p>
                <ul className="space-y-0.5 text-[12px] text-gray-600">
                  {e.levelHistory.map((h, i) => (
                    <li key={i}><span className="font-mono">{h.code}</span> {h.name} · {thaiDate(h.effectiveFrom)} – {h.effectiveTo ? thaiDate(h.effectiveTo) : 'ปัจจุบัน'}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {e.roleAssignments.map((r) => (
                <Badge key={`${r.roleId}-${r.orgUnitId}`} tone={r.role.key === 'EMPLOYEE' ? 'gray' : 'brand'}>{r.role.name}{r.orgUnit && ` · ${r.orgUnit.name}`}</Badge>
              ))}
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-2"><Laptop className="h-4 w-4 text-brand-600" /> อุปกรณ์</span>} bodyClassName="px-5 py-3">
            {!e.devices.length ? (
              <p className="text-[13px] text-gray-500">ยังไม่ได้รับเครื่อง</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {[...current, ...past].map((d) => (
                  <li key={d.assignmentId} className={d.endDate ? 'text-gray-400' : ''}>
                    {can(me, 'asset.read') ? (
                      <Link href={`/it-assets/${encodeURIComponent(d.code)}`} className="font-mono font-medium text-brand-700 hover:underline">{d.code}</Link>
                    ) : (
                      <span className="font-mono font-medium">{d.code}</span>
                    )}
                    <span className="ml-1.5">{d.model ?? d.category}</span>
                    <p className="text-[11px] text-gray-500">
                      {KIND_LABEL[d.kind]} · {thaiDate(d.startDate)} – {d.endDate ? thaiDate(d.endDate) : 'ปัจจุบัน'}
                      {d.dueDate && !d.endDate && ` · คืน ${thaiDate(d.dueDate)}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {editing && options.data && <EditProfileDialog employee={e} options={options.data} onClose={() => setEditing(false)} onDone={() => { setEditing(false); refresh(); }} />}
      {addingAccount && options.data && <AddAccountDialog employeeId={e.id} options={options.data} onClose={() => setAddingAccount(false)} onDone={() => { setAddingAccount(false); refresh(); }} />}
    </div>
  );
}

function AccountRow({ account, canEdit, onChanged }: { account: EmployeeProfile['accounts'][number]; canEdit: boolean; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: () => api(`/onboarding/accounts/${account.id}`, { method: 'PATCH', body: { status: account.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' } }),
    onSuccess: onChanged,
    onError: (e) => setError(errorMessage(e)),
  });
  const disabled = account.status === 'DISABLED';
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="px-5 py-2.5 text-gray-500">{account.system.name}</td>
      <td className={`px-3 py-2.5 font-mono ${disabled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{account.identifier}</td>
      <td className="px-3 py-2.5 text-[12px] text-gray-500">
        <Badge tone={account.status === 'ACTIVE' ? 'brand' : account.status === 'PENDING' ? 'amber' : 'gray'}>{ACCOUNT_STATUS_LABEL[account.status]}</Badge>
        {disabled && account.disabledOn && <span className="ml-1">{thaiDate(account.disabledOn)}</span>}
        {error && <span className="ml-2 text-rose-600">{error}</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        {canEdit && (
          <Button size="sm" variant="ghost" loading={toggle.isPending} onClick={() => (disabled || window.confirm(`ปิดบัญชี ${account.identifier}? (บันทึกว่าปิดแล้ว — ต้องไปปิดในระบบ ${account.system.name} เองด้วย)`)) && toggle.mutate()}>
            {disabled ? 'เปิดใช้อีกครั้ง' : 'ปิดบัญชี'}
          </Button>
        )}
      </td>
    </tr>
  );
}

function AddAccountDialog({ employeeId, options, onClose, onDone }: { employeeId: string; options: OnboardingOptions; onClose: () => void; onDone: () => void }) {
  const [systemId, setSystemId] = useState(options.systems[0]?.id ?? '');
  const [identifier, setIdentifier] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const system = options.systems.find((s) => s.id === systemId);
  const save = useMutation({
    mutationFn: () => api(`/onboarding/employees/${employeeId}/accounts`, { method: 'POST', body: { systemId, identifier, note: note || null } }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="เพิ่มบัญชีในระบบอื่น"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!identifier.trim()} onClick={() => save.mutate()}>บันทึก</Button>
        </>
      }
    >
      <Field label="ระบบ">
        <select className={inputClass} value={systemId} onChange={(e) => setSystemId(e.target.value)}>
          {options.systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label={system?.identifierLabel ?? 'ชื่อบัญชี'} hint="ห้ามใส่รหัสผ่าน"><input className={inputClass} value={identifier} onChange={(e) => setIdentifier(e.target.value)} /></Field>
      <Field label="หมายเหตุ"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

function EditProfileDialog({ employee: e, options, onClose, onDone }: { employee: EmployeeProfile; options: OnboardingOptions; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    employeeCode: e.employeeCode ?? '',
    fullName: e.fullName,
    fullNameEn: e.fullNameEn ?? '',
    nickname: e.nickname ?? '',
    personalEmail: e.personalEmail ?? '',
    employmentType: e.employmentType,
    startDate: e.startDate ?? '',
    endDate: e.endDate ?? '',
    institution: e.institution ?? '',
    departmentId: e.department?.id ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: ev.target.value });
  const save = useMutation({
    mutationFn: () =>
      api(`/employees/${e.id}`, {
        method: 'PATCH',
        body: {
          employeeCode: f.employeeCode || null,
          fullName: f.fullName,
          fullNameEn: f.fullNameEn || null,
          nickname: f.nickname || null,
          ...(e.personalEmail !== undefined ? { personalEmail: f.personalEmail || null } : {}),
          employmentType: f.employmentType,
          startDate: f.startDate || null,
          endDate: f.endDate || null,
          institution: f.institution || null,
          departmentId: f.departmentId || null,
        },
      }),
    onSuccess: onDone,
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog
      wide
      open
      onClose={onClose}
      title={`แก้ไขข้อมูล ${e.fullName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.fullName.trim()} onClick={() => save.mutate()}>บันทึก</Button>
        </>
      }
    >
      <p className="text-[12px] text-gray-500">ทีม ระดับ บทบาท อีเมลเข้าระบบ และสถานะ แก้ได้จากหน้า “พนักงานและสิทธิ์”</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="รหัสพนักงาน"><input className={`${inputClass} font-mono`} value={f.employeeCode} onChange={set('employeeCode')} /></Field>
        <Field label="ประเภท">
          <select className={inputClass} value={f.employmentType} onChange={set('employmentType')}>
            {(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((k) => <option key={k} value={k}>{EMPLOYMENT_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="ชื่อ-นามสกุล"><input className={inputClass} value={f.fullName} onChange={set('fullName')} /></Field>
        <Field label="ชื่อเล่น"><input className={inputClass} value={f.nickname} onChange={set('nickname')} /></Field>
        <Field label="Name / Last name"><input className={inputClass} value={f.fullNameEn} onChange={set('fullNameEn')} /></Field>
        {e.personalEmail !== undefined && <Field label="อีเมลส่วนตัว"><input type="email" className={inputClass} value={f.personalEmail} onChange={set('personalEmail')} /></Field>}
        <Field label="วันเริ่มงาน"><input type="date" className={inputClass} value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label="วันสิ้นสุด"><input type="date" className={inputClass} value={f.endDate} onChange={set('endDate')} /></Field>
        <Field label="แผนก">
          <select className={inputClass} value={f.departmentId} onChange={set('departmentId')}>
            <option value="">— ไม่ระบุ —</option>
            {options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        {f.employmentType === 'INTERN' && <Field label="สถาบัน"><input className={inputClass} value={f.institution} onChange={set('institution')} /></Field>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}
