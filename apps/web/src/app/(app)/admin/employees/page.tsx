'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Dialog, Field, inputClass, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/session';
import type { Role } from '@/lib/types';

interface EmployeeRow {
  id: string;
  fullName: string;
  nickname: string | null;
  email?: string | null;
  roles?: Role[];
  status: 'ACTIVE' | 'INACTIVE';
  orgUnit: { id: string; name: string } | null;
  level: { id: string; code: string; name: string } | null;
}

interface Options {
  roles: Role[];
  orgUnits: { id: string; name: string }[];
  levels: { id: string; code: string; name: string }[];
}

const ROLE_HELP: Record<Role, string> = {
  EMPLOYEE: 'บันทึกเวลาของตนเอง',
  MANAGER: 'ดูรายงานเฉพาะทีมที่ดูแล',
  PARTNER: 'ดูรายงานทั้งบริษัท',
  ADMIN: 'ดูแลข้อมูลหลัก วันหยุด พนักงาน',
  IT: 'จัดการบัญชีผู้ใช้ (ไม่เห็นข้อมูลเวลา)',
};

export default function EmployeesAdminPage() {
  const me = useMe();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const list = useQuery({ queryKey: ['admin-employees'], queryFn: () => api<EmployeeRow[]>('/employees') });
  const options = useQuery({ queryKey: ['employee-options'], queryFn: () => api<Options>('/employees/options') });

  const save = useMutation({
    mutationFn: (e: EmployeeRow) =>
      api(`/employees/${e.id}`, {
        method: 'PATCH',
        body:
          e.id === me.data?.user.id
            ? { orgUnitId: e.orgUnit?.id ?? null, levelId: e.level?.id ?? null, email: e.email || null }
            : { roles: e.roles, status: e.status, orgUnitId: e.orgUnit?.id ?? null, levelId: e.level?.id ?? null, email: e.email || null },
      }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin-employees'] });
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const rows = (list.data ?? []).filter((e) => filter === 'ALL' || e.status === 'ACTIVE');
  const self = editing?.id === me.data?.user.id;

  return (
    <div className="space-y-4">
      <PageHeader title="พนักงานและสิทธิ์" description="บทบาท ทีม และสถานะการใช้งาน" />
      <Alert tone="info">การเปลี่ยนสิทธิ์หรือสถานะจะทำให้ผู้ใช้คนนั้นต้องเข้าสู่ระบบใหม่ทันที และทุกการเปลี่ยนแปลงถูกบันทึกใน Audit log</Alert>
      <Card
        title="พนักงาน"
        actions={
          <select aria-label="กรองสถานะ" className={`${inputClass} w-40 py-1`} value={filter} onChange={(e) => setFilter(e.target.value as 'ACTIVE' | 'ALL')}>
            <option value="ACTIVE">เฉพาะที่ทำงานอยู่</option>
            <option value="ALL">ทั้งหมด</option>
          </select>
        }
      >
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <Alert tone="error">{errorMessage(list.error)}</Alert>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="border-b text-left">
              <tr>
                <th className="py-1 pr-2">ชื่อ</th>
                <th className="py-1 pr-2">อีเมล (SSO)</th>
                <th className="py-1 pr-2">ทีม</th>
                <th className="py-1 pr-2">ระดับ</th>
                <th className="py-1 pr-2">สิทธิ์</th>
                <th className="py-1 pr-2">สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2">{e.fullName}</td>
                  <td className="py-1.5 pr-2">{e.email ?? <span className="text-amber-700">ยังไม่ผูก</span>}</td>
                  <td className="py-1.5 pr-2">{e.orgUnit?.name ?? '-'}</td>
                  <td className="py-1.5 pr-2">{e.level?.code ?? '-'}</td>
                  <td className="py-1.5 pr-2">{(e.roles ?? []).filter((r) => r !== 'EMPLOYEE').join(', ') || 'EMPLOYEE'}</td>
                  <td className="py-1.5 pr-2">{e.status === 'ACTIVE' ? 'ทำงาน' : <span className="text-gray-500">พ้นสภาพ</span>}</td>
                  <td className="py-1.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setError(null); setEditing(e); }}>
                      แก้ไข
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`แก้ไข: ${editing?.fullName ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              ยกเลิก
            </Button>
            <Button variant="primary" disabled={save.isPending || !editing?.roles?.length} onClick={() => editing && save.mutate(editing)}>
              บันทึก
            </Button>
          </>
        }
      >
        {editing && options.data && (
          <>
            <Field label="อีเมลองค์กร (ใช้จับคู่ตอน SSO)">
              <input className={inputClass} type="email" value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </Field>
            <Field label="ทีม">
              <select
                className={inputClass}
                value={editing.orgUnit?.id ?? ''}
                onChange={(e) => setEditing({ ...editing, orgUnit: options.data.orgUnits.find((o) => o.id === e.target.value) ?? null })}
              >
                <option value="">— ไม่ระบุ —</option>
                {options.data.orgUnits.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ระดับ">
              <select className={inputClass} value={editing.level?.id ?? ''} onChange={(e) => setEditing({ ...editing, level: options.data.levels.find((l) => l.id === e.target.value) ?? null })}>
                <option value="">— ไม่ระบุ —</option>
                {options.data.levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset disabled={self}>
              <legend className="mb-1 text-sm font-medium text-gray-700">สิทธิ์ {self && <span className="font-normal text-gray-500">(แก้ไขสิทธิ์ของตนเองไม่ได้)</span>}</legend>
              <div className="space-y-1">
                {options.data.roles.map((r) => (
                  <label key={r} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={editing.roles?.includes(r) ?? false}
                      onChange={(e) => setEditing({ ...editing, roles: e.target.checked ? [...(editing.roles ?? []), r] : (editing.roles ?? []).filter((x) => x !== r) })}
                    />
                    <span>
                      <span className="font-medium">{r}</span> <span className="text-gray-500">— {ROLE_HELP[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.status === 'ACTIVE'} onChange={(e) => setEditing({ ...editing, status: e.target.checked ? 'ACTIVE' : 'INACTIVE' })} />
                ยังทำงานอยู่ (ปิด = เข้าสู่ระบบไม่ได้)
              </label>
            </fieldset>
            {error && <Alert tone="error">{error}</Alert>}
          </>
        )}
      </Dialog>
    </div>
  );
}
