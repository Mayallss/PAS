'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, inputClass, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { can, useSession } from '@/lib/session';
import type { CustomerOption, EngagementOption } from '@/lib/types';
import { Activities, type Activity } from './activities';
import { trcloudStatusQuery } from '@/lib/trcloud';
import { TrcloudCustomersBar } from './trcloud-bar';

interface CustomerForm {
  id?: string;
  /** From TRCLOUD: code, name, tax id, address and active state are TRCLOUD's (read-only here). */
  trcloud?: boolean;
  code: string;
  name: string;
  taxId: string;
  address: string;
  accountOwnerId: string;
  isActive: boolean;
}

const emptyForm: CustomerForm = { code: '', name: '', taxId: '', address: '', accountOwnerId: '', isActive: true };

export default function CustomersAdminPage() {
  const qc = useQueryClient();
  const me = useSession();
  const [search, setSearch] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const deferred = useDeferredValue(search.trim());
  const [editing, setEditing] = useState<CustomerForm | null>(null);
  const [selected, setSelected] = useState<CustomerOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customers = useQuery({
    queryKey: ['admin-customers', deferred],
    queryFn: () => api<CustomerOption[]>('/catalog/customers', { query: { search: deferred, includeInactive: 'true' } }),
  });
  const trcloud = useQuery({ ...trcloudStatusQuery, enabled: can(me, 'revenue.write', 'catalog.write') });
  const trcloudOn = !!trcloud.data?.enabled;
  const shown = (customers.data ?? []).filter((c) => showClosed || c.isActive);
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => api<{ id: string; fullName: string; status: string }[]>('/employees') });

  const save = useMutation({
    mutationFn: (f: CustomerForm) =>
      api(f.id ? `/catalog/customers/${f.id}` : '/catalog/customers', {
        method: f.id ? 'PUT' : 'POST',
        body: {
          code: f.code,
          name: f.name,
          taxId: f.taxId || null,
          address: f.address || null,
          accountOwnerId: f.accountOwnerId || null,
          isActive: f.isActive,
        },
      }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin-customers'] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="ลูกค้าและ Activity" description="ลูกค้า (JOB) และ Activity ที่แต่ละลูกค้าเปิดให้พนักงานลงเวลาได้" />
      {can(me, 'revenue.write', 'catalog.write') && <TrcloudCustomersBar />}
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card
          title="ลูกค้า"
          actions={
            <>
              <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-gray-700">
                <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> แสดงที่ปิดแล้ว
              </label>
              <input aria-label="ค้นหาลูกค้า" className={`${inputClass} w-56 py-1`} placeholder="ค้นหารหัส / ชื่อ" value={search} onChange={(e) => setSearch(e.target.value)} />
              {/* With TRCLOUD, customers are added in TRCLOUD: one added here would be removed by the next sync. */}
              {!trcloudOn && (
                <Button size="sm" variant="primary" onClick={() => { setError(null); setEditing({ ...emptyForm }); }}>
                  + เพิ่มลูกค้า
                </Button>
              )}
            </>
          }
        >
          {customers.isLoading ? (
            <Loading />
          ) : !shown.length ? (
            <Empty>ไม่พบลูกค้า</Empty>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 border-b bg-white text-left">
                  <tr>
                    <th className="py-1 pr-2">รหัส</th>
                    <th className="py-1 pr-2">ชื่อ</th>
                    <th className="py-1 pr-2">ผู้ดูแล</th>
                    <th className="py-1 pr-2">สถานะ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id} className={`border-b border-gray-100 ${selected?.id === c.id ? 'bg-brand-50' : ''}`}>
                      <td className="py-1.5 pr-2 font-mono">{c.code}</td>
                      <td className="py-1.5 pr-2">
                        {c.name}
                        {trcloudOn && !!c.trcloudLinks?.length && (
                          <span className="ml-2 inline-flex gap-1 align-middle">
                            {c.trcloudLinks.map((l) => (
                              <span key={l.company} title={`${l.company}: ${l.contactCode}`}>
                                <Badge tone="brand">{l.company}</Badge>
                              </span>
                            ))}
                          </span>
                        )}
                        {trcloudOn && !c.trcloudLinks?.length && c.isActive && (
                          <span className="ml-2 inline-block align-middle">
                            <Badge tone="gray">ภายใน · ไม่ซิงก์</Badge>
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">{c.accountOwner?.fullName ?? '-'}</td>
                      <td className="py-1.5 pr-2">{c.isActive ? 'ใช้งาน' : <span className="text-gray-500">{trcloudOn ? 'ปิด (ไม่มีใน TRCLOUD)' : 'ปิด'}</span>}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setSelected(c)}>
                          งาน
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setError(null);
                            setEditing({ id: c.id, trcloud: !!c.trcloudLinks?.length, code: c.code, name: c.name, taxId: c.taxId ?? '', address: c.address ?? '', accountOwnerId: c.accountOwner?.id ?? '', isActive: c.isActive });
                          }}
                        >
                          แก้ไข
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {selected ? <Engagements customer={selected} /> : <Card title="Activity ของลูกค้า"><Empty>เลือกลูกค้าเพื่อกำหนด Activity ที่ลงเวลาได้</Empty></Card>}
      </div>

      <Activities />

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              ยกเลิก
            </Button>
            <Button variant="primary" disabled={save.isPending || !editing?.code || !editing?.name} onClick={() => editing && save.mutate(editing)}>
              บันทึก
            </Button>
          </>
        }
      >
        {editing && (
          <>
            {editing.trcloud ? (
              <Alert tone="info">ลูกค้านี้มาจาก TRCLOUD — รหัส ชื่อ เลขภาษี ที่อยู่ และสถานะ ให้แก้ที่ TRCLOUD แล้วระบบจะซิงก์ให้ ที่นี่แก้ได้เฉพาะผู้ดูแลลูกค้า</Alert>
            ) : (
              trcloudOn && <Alert tone="info">ลูกค้าภายใน (มีงานภายใน / ประชุม / ลา) ไม่ซิงก์กับ TRCLOUD และไม่ถูกเอาออก</Alert>
            )}
            <Field label="รหัสลูกค้า" hint={editing.trcloud ? 'รหัสคู่ค้า (#code) ใน TRCLOUD — ใช้ของ PAS ก่อน ถ้าไม่มีใช้ PC แล้ว PA' : 'แก้ไขได้ภายหลังโดยไม่กระทบข้อมูลเวลาเดิม'}>
              <input className={inputClass} maxLength={40} disabled={editing.trcloud} value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/\s+/g, '') })} />
            </Field>
            <Field label="ชื่อ">
              <input className={inputClass} maxLength={200} disabled={editing.trcloud} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="เลขประจำตัวผู้เสียภาษี" hint="13 หลัก (ไม่บังคับ)">
              <input className={inputClass} inputMode="numeric" maxLength={13} disabled={editing.trcloud} value={editing.taxId} onChange={(e) => setEditing({ ...editing, taxId: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label="ที่อยู่">
              <textarea className={inputClass} rows={2} maxLength={500} disabled={editing.trcloud} value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </Field>
            <Field label="ผู้ดูแลลูกค้า">
              <select className={inputClass} value={editing.accountOwnerId} onChange={(e) => setEditing({ ...editing, accountOwnerId: e.target.value })}>
                <option value="">— ไม่ระบุ —</option>
                {(employees.data ?? []).filter((e) => e.status === 'ACTIVE').map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={editing.trcloud} checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> ใช้งาน
            </label>
            {error && <Alert tone="error">{error}</Alert>}
          </>
        )}
      </Dialog>
    </div>
  );
}

function Engagements({ customer }: { customer: CustomerOption }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const categories = useQuery({ queryKey: ['work-categories'], queryFn: () => api<Activity[]>('/catalog/work-categories') });
  const engagements = useQuery({
    queryKey: ['admin-engagements', customer.id],
    queryFn: () => api<EngagementOption[]>(`/catalog/customers/${customer.id}/engagements`, { query: { includeInactive: 'true' } }),
  });
  const toggle = useMutation({
    mutationFn: ({ workCategoryId, isActive }: { workCategoryId: string; isActive: boolean }) =>
      api(`/catalog/customers/${customer.id}/engagements/${workCategoryId}`, { method: 'PUT', body: { isActive } }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin-engagements', customer.id] });
      void qc.invalidateQueries({ queryKey: ['engagements', customer.id] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const active = new Set((engagements.data ?? []).filter((e) => e.isActive).map((e) => e.workCategory.id));

  return (
    <Card title={`Activity ของ ${customer.code}`} description={customer.name}>
      {error && <Alert tone="error">{error}</Alert>}
      {categories.isLoading || engagements.isLoading ? (
        <Loading />
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-auto text-sm">
          {(() => {
            const leaves = (categories.data ?? []).filter((c) => c.isActive && c.childCount === 0);
            const groupNames = [...new Set(leaves.map((c) => c.parent?.name ?? ''))];
            return groupNames.map((g) => (
              <div key={g || 'none'}>
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-gray-400 uppercase">{g || 'ไม่อยู่ในกลุ่ม'}</p>
                <ul className="divide-y divide-gray-100">
                  {leaves
                    .filter((c) => (c.parent?.name ?? '') === g)
                    .map((c) => (
                      <li key={c.id}>
                        <label className="flex items-center gap-2 py-1.5">
                          <input type="checkbox" checked={active.has(c.id)} disabled={toggle.isPending} onChange={(e) => toggle.mutate({ workCategoryId: c.id, isActive: e.target.checked })} />
                          {c.name}
                        </label>
                      </li>
                    ))}
                </ul>
              </div>
            ));
          })()}
        </div>
      )}
    </Card>
  );
}
