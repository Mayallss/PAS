'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, inputClass, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { todayBangkok } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { CostRates } from './_components/cost-rates';
import { Teams, treeOrder, unitPath } from './teams';

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem?: boolean;
  assignmentCount?: number;
}
interface Assignment {
  roleId: string;
  orgUnitId: string | null;
  role?: { key: string; name: string };
  orgUnit?: { name: string } | null;
}
interface EmployeeRow {
  id: string;
  fullName: string;
  nickname: string | null;
  email?: string | null;
  employeeCode?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  orgUnit: { id: string; name: string } | null;
  level: { id: string; code: string; name: string } | null;
  roleAssignments?: Assignment[];
}
interface Options {
  orgUnits: { id: string; name: string; parentId: string | null }[];
  levels: { id: string; code: string; name: string }[];
  roles: RoleRow[];
}

export default function EmployeesAdminPage() {
  const me = useSession();
  return (
    <div>
      <PageHeader
        title="พนักงานและสิทธิ์"
        description="มอบบทบาทได้ทั้งแบบทั้งบริษัทและเฉพาะทีม — การเปลี่ยนสิทธิ์มีผลทันที และถูกบันทึกใน Audit log"
        actions={
          <Link href="/admin/employees/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
            <UserPlus className="h-4 w-4" /> เพิ่มพนักงานใหม่
          </Link>
        }
      />
      <div className="space-y-4">
        <Employees />
        {can(me, 'employee.admin') && <Teams />}
        {can(me, 'cost.read') && <CostRates />}
        {can(me, 'role.admin', 'employee.admin') && <Roles />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Employees() {
  const me = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [filter, setFilter] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [search, setSearch] = useState('');
  const list = useQuery({ queryKey: ['admin-employees'], queryFn: () => api<EmployeeRow[]>('/employees') });
  const options = useQuery({ queryKey: ['employee-options'], queryFn: () => api<Options>('/employees/options') });

  const rows = (list.data ?? [])
    .filter((e) => filter === 'ALL' || e.status === 'ACTIVE')
    .filter((e) => !search || `${e.fullName} ${e.nickname ?? ''} ${e.email ?? ''} ${e.employeeCode ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <Card
      title="พนักงาน"
      actions={
        <>
          <input aria-label="ค้นหาพนักงาน" placeholder="ค้นหาชื่อ / อีเมล" className={`${inputClass} w-52`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="กรองสถานะ" className={`${inputClass} w-40`} value={filter} onChange={(e) => setFilter(e.target.value as 'ACTIVE' | 'ALL')}>
            <option value="ACTIVE">เฉพาะที่ทำงานอยู่</option>
            <option value="ALL">ทั้งหมด</option>
          </select>
        </>
      }
      bodyClassName="p-0"
    >
      {list.isLoading ? (
        <div className="p-5"><Loading /></div>
      ) : list.error ? (
        <div className="p-5"><Alert tone="error">{errorMessage(list.error)}</Alert></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[13px]">
            <thead className="border-b border-gray-200 text-left text-[12px] text-gray-500">
              <tr>
                <th className="px-5 py-2 font-medium">พนักงาน</th>
                <th className="px-3 py-2 font-medium">ทีม / ระดับ</th>
                <th className="px-3 py-2 font-medium">บทบาท</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                  <td className="px-5 py-2.5">
                    <Link href={`/admin/employees/${e.id}`} className="font-medium text-gray-900 hover:text-brand-700 hover:underline">
                      {e.fullName} {e.nickname && <span className="font-normal text-gray-500">({e.nickname})</span>}
                    </Link>
                    {e.employeeCode && <span className="ml-1.5 font-mono text-[11px] text-gray-400">{e.employeeCode}</span>}
                    <p className="text-[12px] text-gray-500">{e.email ?? <span className="text-amber-700">ยังไม่ผูกอีเมล SSO</span>}</p>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">
                    {e.orgUnit?.name ?? '–'}
                    {e.level && <span className="text-gray-400"> · {e.level.code}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(e.roleAssignments ?? []).map((a) => (
                        <Badge key={`${a.roleId}-${a.orgUnitId}`} tone={a.role?.key === 'EMPLOYEE' ? 'gray' : 'brand'}>
                          {a.role?.name}
                          {a.orgUnit && <span className="opacity-70">· {a.orgUnit.name}</span>}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{e.status === 'ACTIVE' ? <Badge tone="brand">ทำงาน</Badge> : <Badge>พ้นสภาพ</Badge>}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label={`แก้ไข ${e.fullName}`}>
                      <Pencil className="h-3.5 w-3.5" /> แก้ไข
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && options.data && (
        <EditEmployee
          key={editing.id}
          employee={editing}
          options={options.data}
          self={editing.id === me.user.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['admin-employees'] });
            void qc.invalidateQueries({ queryKey: ['employees'] });
          }}
        />
      )}
    </Card>
  );
}

function EditEmployee({ employee, options, self, onClose, onSaved }: { employee: EmployeeRow; options: Options; self: boolean; onClose: () => void; onSaved: () => void }) {
  const me = useSession();
  const [email, setEmail] = useState(employee.email ?? '');
  const [orgUnitId, setOrgUnitId] = useState(employee.orgUnit?.id ?? '');
  const [levelId, setLevelId] = useState(employee.level?.id ?? '');
  const [levelFrom, setLevelFrom] = useState(todayBangkok());
  const levelChanged = levelId !== (employee.level?.id ?? '');
  const [active, setActive] = useState(employee.status === 'ACTIVE');
  const [assignments, setAssignments] = useState<Assignment[]>(employee.roleAssignments?.map(({ roleId, orgUnitId }) => ({ roleId, orgUnitId })) ?? []);
  const [error, setError] = useState<string | null>(null);
  // Roles with permissions the current admin lacks cannot be granted (enforced by the API too).
  const grantable = (r: RoleRow) => r.permissions.every((p) => me.user.permissions.includes(p as never));

  const save = useMutation({
    mutationFn: () =>
      api(`/employees/${employee.id}`, {
        method: 'PATCH',
        body: {
          email: email.trim() || null,
          orgUnitId: orgUnitId || null,
          levelId: levelId || null,
          ...(levelChanged ? { levelEffectiveFrom: levelFrom } : {}),
          ...(self ? {} : { status: active ? 'ACTIVE' : 'INACTIVE', roleAssignments: assignments.filter((a) => a.roleId) }),
        },
      }),
    onSuccess: onSaved,
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`แก้ไข: ${employee.fullName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!self && assignments.filter((a) => a.roleId).length === 0} onClick={() => save.mutate()}>
            บันทึก
          </Button>
        </>
      }
    >
      <Field label="อีเมลองค์กร (ใช้จับคู่ตอน SSO)">
        <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ทีม">
          <select className={inputClass} value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
            <option value="">— ไม่ระบุ —</option>
            {treeOrder(options.orgUnits).map(({ unit: o }) => (
              <option key={o.id} value={o.id}>{unitPath(options.orgUnits, o.id)}</option>
            ))}
          </select>
        </Field>
        <Field label="ระดับ">
          <select className={inputClass} value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            <option value="">— ไม่ระบุ —</option>
            {options.levels.map((l) => (
              <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
            ))}
          </select>
        </Field>
      </div>
      {levelChanged && (
        <Field label="ระดับใหม่มีผลตั้งแต่วันที่" hint="ระดับเดิมจะสิ้นสุดวันก่อนหน้า — รายงานต้นทุนแบบ “ระดับ ณ วันที่ทำงาน” ใช้ค่านี้">
          <input type="date" className={inputClass} value={levelFrom} onChange={(e) => setLevelFrom(e.target.value)} />
        </Field>
      )}
      <fieldset disabled={self} className="space-y-2">
        <legend className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-gray-700">
          <ShieldCheck className="h-4 w-4 text-gray-400" /> บทบาท {self && <span className="font-normal text-gray-500">(แก้ไขของตนเองไม่ได้)</span>}
        </legend>
        {assignments.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              aria-label="บทบาท"
              className={inputClass}
              value={a.roleId}
              onChange={(e) => setAssignments(assignments.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))}
            >
              <option value="">— เลือกบทบาท —</option>
              {options.roles.map((r) => (
                <option key={r.id} value={r.id} disabled={!grantable(r)}>
                  {r.name}{!grantable(r) ? ' (สิทธิ์เกินของคุณ)' : ''}
                </option>
              ))}
            </select>
            <select
              aria-label="ขอบเขต"
              className={`${inputClass} w-44`}
              value={a.orgUnitId ?? ''}
              onChange={(e) => setAssignments(assignments.map((x, j) => (j === i ? { ...x, orgUnitId: e.target.value || null } : x)))}
            >
              <option value="">ทั้งบริษัท / ทีมที่ดูแล</option>
              {treeOrder(options.orgUnits).map(({ unit: o }) => (
                <option key={o.id} value={o.id}>เฉพาะ {unitPath(options.orgUnits, o.id)}</option>
              ))}
            </select>
            <button type="button" aria-label="ลบบทบาทนี้" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={() => setAssignments(assignments.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setAssignments([...assignments, { roleId: '', orgUnitId: null }])}>
          <Plus className="h-3.5 w-3.5" /> เพิ่มบทบาท
        </Button>
        <label className="mt-2 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          ยังทำงานอยู่ (ปิด = เข้าสู่ระบบไม่ได้ทันที)
        </label>
      </fieldset>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function Roles() {
  const me = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api<{ catalogue: { key: string; label: string }[]; roles: RoleRow[] }>('/roles') });
  const [editing, setEditing] = useState<Partial<RoleRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isRoleAdmin = can(me, 'role.admin');
  const labels = new Map(q.data?.catalogue.map((c) => [c.key, c.label]));

  const save = useMutation({
    mutationFn: (r: Partial<RoleRow>) =>
      api(r.id ? `/roles/${r.id}` : '/roles', {
        method: r.id ? 'PUT' : 'POST',
        body: { key: r.key, name: r.name, description: r.description || null, permissions: r.permissions ?? [] },
      }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['roles'] });
      void qc.invalidateQueries({ queryKey: ['employee-options'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['roles'] }),
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-brand-600" /> บทบาทและสิทธิ์
        </span>
      }
      description="สิทธิ์ของแต่ละบทบาทเป็นข้อมูล แก้ได้โดยไม่ต้องแก้โค้ด — มอบบทบาทที่มีสิทธิ์มากกว่าที่ตนเองมีไม่ได้"
      actions={
        isRoleAdmin && (
          <Button size="sm" variant="primary" onClick={() => { setError(null); setEditing({ key: '', name: '', permissions: [] }); }}>
            <Plus className="h-3.5 w-3.5" /> สร้างบทบาท
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      {error && !editing && <div className="p-4"><Alert tone="error">{error}</Alert></div>}
      {!q.data ? (
        <div className="p-5"><Loading rows={3} /></div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {q.data.roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
              <div className="w-52 shrink-0">
                <p className="text-[13px] font-medium text-gray-900">
                  {r.name} {r.isSystem && <Badge>ระบบ</Badge>}
                </p>
                <p className="font-mono text-[11px] text-gray-400">{r.key} · {r.assignmentCount} คน</p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {r.permissions.map((p) => (
                  <Badge key={p} tone="sky">{labels.get(p) ?? p}</Badge>
                ))}
              </div>
              {isRoleAdmin && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setError(null); setEditing(r); }} aria-label={`แก้ไขบทบาท ${r.name}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!r.isSystem && (
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => window.confirm(`ลบบทบาท ${r.name}?`) && remove.mutate(r.id)} aria-label={`ลบบทบาท ${r.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `แก้ไขบทบาท ${editing.name}` : 'สร้างบทบาท'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>ยกเลิก</Button>
            <Button variant="primary" loading={save.isPending} disabled={!editing?.key || !editing?.name} onClick={() => editing && save.mutate(editing)}>บันทึก</Button>
          </>
        }
      >
        {editing && q.data && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="รหัส (A-Z)">
                <input className={`${inputClass} font-mono`} disabled={!!editing.isSystem} value={editing.key ?? ''} onChange={(e) => setEditing({ ...editing, key: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="ชื่อที่แสดง">
                <input className={inputClass} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
            </div>
            <Field label="คำอธิบาย">
              <input className={inputClass} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-[13px] font-medium text-gray-700">สิทธิ์</legend>
              {q.data.catalogue.map((c) => {
                const mine = me.user.permissions.includes(c.key as never);
                return (
                  <label key={c.key} className={`flex items-center gap-2 text-[13px] ${mine ? '' : 'text-gray-400'}`}>
                    <input
                      type="checkbox"
                      disabled={!mine}
                      checked={editing.permissions?.includes(c.key) ?? false}
                      onChange={(e) =>
                        setEditing({ ...editing, permissions: e.target.checked ? [...(editing.permissions ?? []), c.key] : (editing.permissions ?? []).filter((p) => p !== c.key) })
                      }
                    />
                    {c.label} <span className="font-mono text-[11px] text-gray-400">{c.key}</span>
                  </label>
                );
              })}
            </fieldset>
            {error && <Alert tone="error">{error}</Alert>}
          </>
        )}
      </Dialog>
    </Card>
  );
}
