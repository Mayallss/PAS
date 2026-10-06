'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Circle, Laptop, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { AssetRow, AssetSummary } from '@/lib/assets';
import { addDays, thaiDate, todayBangkok } from '@/lib/format';
import { EMPLOYMENT_LABEL, type EmploymentType, type OnboardingOptions } from '@/lib/onboarding';
import { can, useSession } from '@/lib/session';
import { treeOrder, unitPath } from '../teams';

interface EmployeeOptions {
  orgUnits: { id: string; name: string; parentId: string | null }[];
  levels: { id: string; code: string; name: string }[];
  roles: { id: string; key: string; name: string; permissions: string[] }[];
}

export default function NewEmployeePage() {
  const me = useSession();
  const router = useRouter();
  const seesAssets = can(me, 'asset.read');
  const empOptions = useQuery({ queryKey: ['employee-options'], queryFn: () => api<EmployeeOptions>('/employees/options') });
  const obOptions = useQuery({ queryKey: ['onboarding-options'], queryFn: () => api<OnboardingOptions>('/onboarding/options') });
  const spare = useQuery({
    queryKey: ['assets', 'spare'],
    queryFn: () => api<{ summary: AssetSummary; rows: AssetRow[] }>('/assets', { query: { state: 'AVAILABLE' } }),
    enabled: seesAssets,
  });

  const [f, setF] = useState({
    employeeCode: '',
    fullName: '',
    fullNameEn: '',
    nickname: '',
    employmentType: 'EMPLOYEE' as EmploymentType,
    startDate: todayBangkok(),
    endDate: '',
    institution: '',
    email: '',
    personalEmail: '',
    departmentId: '',
    orgUnitId: '',
    levelId: '',
  });
  const [roles, setRoles] = useState<{ roleId: string; orgUnitId: string | null }[] | null>(null);
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceKind, setDeviceKind] = useState<'PRIMARY' | 'LOAN'>('PRIMARY');
  const [deviceDue, setDeviceDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const employeeRole = empOptions.data?.roles.find((r) => r.key === 'EMPLOYEE');
  const grants = roles ?? (employeeRole ? [{ roleId: employeeRole.id, orgUnitId: null }] : []);
  const grantable = (r: EmployeeOptions['roles'][number]) => r.permissions.every((p) => me.user.permissions.includes(p as never));
  const intern = f.employmentType === 'INTERN';
  const checklist = (obOptions.data?.templates ?? []).filter((t) => !t.appliesTo.length || t.appliesTo.includes(f.employmentType));

  const save = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/employees', {
        method: 'POST',
        body: {
          employeeCode: f.employeeCode || null,
          fullName: f.fullName,
          fullNameEn: f.fullNameEn || null,
          nickname: f.nickname || null,
          employmentType: f.employmentType,
          startDate: f.startDate,
          endDate: f.endDate || null,
          institution: intern ? f.institution || null : null,
          email: f.email || null,
          personalEmail: f.personalEmail || null,
          departmentId: f.departmentId || null,
          orgUnitId: f.orgUnitId || null,
          levelId: f.levelId || null,
          roleAssignments: grants.filter((g) => g.roleId),
          device: deviceCode ? { assetCode: deviceCode, kind: deviceKind, dueDate: deviceKind === 'LOAN' ? deviceDue : null } : null,
        },
      }),
    onSuccess: (r) => router.push(`/admin/employees/${r.id}`),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!empOptions.data || !obOptions.data) return <Loading rows={8} />;
  const ready = f.fullName.trim() && f.startDate && grants.some((g) => g.roleId) && (!deviceCode || deviceKind === 'PRIMARY' || deviceDue);

  return (
    <div>
      <Link href="/admin/employees" className="mb-3 inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> พนักงานและสิทธิ์
      </Link>
      <PageHeader title="เพิ่มพนักงานใหม่" description="บันทึกครั้งเดียว: สร้างพนักงาน สิทธิ์เข้าระบบ PAS มอบเครื่อง และสร้าง Checklist งานที่ IT/Admin ต้องทำ" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
      >
        <div className="space-y-4">
          <Card title="1. ข้อมูลพนักงาน">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ประเภท">
                <select className={inputClass} value={f.employmentType} onChange={set('employmentType')}>
                  {(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((k) => (
                    <option key={k} value={k}>{EMPLOYMENT_LABEL[k]}</option>
                  ))}
                </select>
              </Field>
              <Field label="รหัสพนักงาน" hint={intern ? 'นักศึกษาฝึกงานใช้รหัส 1xxx' : 'เช่น 0270'}>
                <input className={`${inputClass} font-mono`} value={f.employeeCode} onChange={set('employeeCode')} />
              </Field>
              <Field label="ชื่อ-นามสกุล (ไทย)"><input required className={inputClass} value={f.fullName} onChange={set('fullName')} /></Field>
              <Field label="ชื่อเล่น"><input className={inputClass} value={f.nickname} onChange={set('nickname')} /></Field>
              <Field label="Name / Last name"><input className={inputClass} value={f.fullNameEn} onChange={set('fullNameEn')} /></Field>
              <Field label="อีเมลส่วนตัว" hint="ใช้ติดต่อก่อนมีอีเมลบริษัท (เห็นเฉพาะผู้ดูแล)"><input type="email" className={inputClass} value={f.personalEmail} onChange={set('personalEmail')} /></Field>
              <Field label="วันเริ่มงาน"><input type="date" required className={inputClass} value={f.startDate} onChange={set('startDate')} /></Field>
              <Field label={intern ? 'วันสิ้นสุดฝึกงาน' : 'วันสิ้นสุด (ถ้ามี)'}><input type="date" min={f.startDate} className={inputClass} value={f.endDate} onChange={set('endDate')} /></Field>
              {intern && <Field label="สถาบัน"><input className={inputClass} value={f.institution} onChange={set('institution')} placeholder="มหาวิทยาลัย / ชั้นปี" /></Field>}
            </div>
          </Card>

          <Card title="2. สังกัดและสิทธิ์เข้าระบบ PAS">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="แผนก">
                <select className={inputClass} value={f.departmentId} onChange={set('departmentId')}>
                  <option value="">— ไม่ระบุ —</option>
                  {obOptions.data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="ทีม">
                <select className={inputClass} value={f.orgUnitId} onChange={set('orgUnitId')}>
                  <option value="">— ไม่ระบุ —</option>
                  {treeOrder(empOptions.data.orgUnits).map(({ unit: o }) => <option key={o.id} value={o.id}>{unitPath(empOptions.data!.orgUnits, o.id)}</option>)}
                </select>
              </Field>
              <Field label="ระดับ">
                <select className={inputClass} value={f.levelId} onChange={set('levelId')}>
                  <option value="">— ไม่ระบุ —</option>
                  {empOptions.data.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="อีเมลบริษัท (ใช้เข้าสู่ระบบ PAS)" hint="เว้นว่างได้ถ้ายังไม่มี — Checklist จะเตือนให้เพิ่ม">
                <input type="email" className={inputClass} value={f.email} onChange={set('email')} placeholder="name@pas-acc.com" />
              </Field>
            </div>
            <fieldset className="mt-4 space-y-2">
              <legend className="mb-1.5 text-[13px] font-medium text-gray-700">บทบาท</legend>
              {grants.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select aria-label="บทบาท" className={inputClass} value={g.roleId} onChange={(e) => setRoles(grants.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))}>
                    <option value="">— เลือกบทบาท —</option>
                    {empOptions.data.roles.map((r) => (
                      <option key={r.id} value={r.id} disabled={!grantable(r)}>{r.name}{!grantable(r) ? ' (สิทธิ์เกินของคุณ)' : ''}</option>
                    ))}
                  </select>
                  <select aria-label="ขอบเขต" className={`${inputClass} w-48`} value={g.orgUnitId ?? ''} onChange={(e) => setRoles(grants.map((x, j) => (j === i ? { ...x, orgUnitId: e.target.value || null } : x)))}>
                    <option value="">ทั้งบริษัท / ทีมที่ดูแล</option>
                    {treeOrder(empOptions.data.orgUnits).map(({ unit: o }) => <option key={o.id} value={o.id}>เฉพาะ {unitPath(empOptions.data!.orgUnits, o.id)}</option>)}
                  </select>
                  <button type="button" aria-label="ลบบทบาทนี้" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100" onClick={() => setRoles(grants.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setRoles([...grants, { roleId: '', orgUnitId: null }])}><Plus className="h-3.5 w-3.5" /> เพิ่มบทบาท</Button>
            </fieldset>
          </Card>

          <Card title="3. เครื่องที่มอบให้ (ไม่บังคับ)" description="เลือกจากเครื่องสำรอง หรือเว้นไว้แล้วทำใน Checklist ภายหลัง">
            {!seesAssets ? (
              <p className="text-[13px] text-gray-500">คุณไม่มีสิทธิ์ดูทะเบียนอุปกรณ์ — ฝ่าย IT จะมอบเครื่องจาก Checklist</p>
            ) : spare.isLoading ? (
              <Loading rows={2} />
            ) : !spare.data?.rows.length ? (
              <p className="text-[13px] text-gray-500">ไม่มีเครื่องสำรองว่างอยู่ตอนนี้</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="เครื่อง">
                  <select className={inputClass} value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)}>
                    <option value="">— ยังไม่มอบ —</option>
                    {spare.data.rows.map((a) => (
                      <option key={a.id} value={a.code}>{a.code} · {[a.brand, a.model].filter(Boolean).join(' ') || a.category.name}{a.ageYears !== null ? ` · ${a.ageYears} ปี` : ''}</option>
                    ))}
                  </select>
                </Field>
                {deviceCode && (
                  <>
                    <Field label="ลักษณะ">
                      <select className={inputClass} value={deviceKind} onChange={(e) => setDeviceKind(e.target.value as 'PRIMARY' | 'LOAN')}>
                        <option value="PRIMARY">ใช้ประจำ</option>
                        <option value="LOAN">ยืมชั่วคราว</option>
                      </select>
                    </Field>
                    {deviceKind === 'LOAN' && <Field label="กำหนดคืน"><input type="date" min={f.startDate} className={inputClass} value={deviceDue} onChange={(e) => setDeviceDue(e.target.value)} /></Field>}
                  </>
                )}
              </div>
            )}
          </Card>

          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Link href="/admin/employees" className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm text-gray-600 hover:bg-gray-100">ยกเลิก</Link>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!ready}>บันทึกและสร้าง Checklist</Button>
          </div>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card title="4. Checklist ที่จะถูกสร้าง" description={`สำหรับ${EMPLOYMENT_LABEL[f.employmentType]} — ครบกำหนดนับจากวันเริ่มงาน`} bodyClassName="px-5 py-3">
            <ul className="space-y-2.5 text-[13px]">
              {checklist.map((t) => {
                const auto = (t.key === 'pas-login' && !!f.email) || (t.requiresAsset && !!deviceCode);
                return (
                  <li key={t.id} className="flex gap-2">
                    {auto ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />}
                    <div className="min-w-0">
                      <p className={auto ? 'text-gray-500' : 'text-gray-900'}>{t.title}</p>
                      <p className="text-[11px] text-gray-500">
                        {t.dueOffsetDays ? `ภายใน ${f.startDate ? thaiDate(addDays(f.startDate, t.dueOffsetDays)) : `${t.dueOffsetDays} วัน`}` : 'วันแรก'}
                        {t.system && <> · บันทึกชื่อบัญชี {t.system.name}</>}
                        {auto && <> · <Badge tone="brand">เสร็จอัตโนมัติ</Badge></>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {deviceCode && (
              <p className="mt-3 flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1.5 text-[12px] text-sky-800">
                <Laptop className="h-3.5 w-3.5" /> มอบ {deviceCode} ตั้งแต่วันเริ่มงาน
              </p>
            )}
          </Card>
        </aside>
      </form>
    </div>
  );
}
