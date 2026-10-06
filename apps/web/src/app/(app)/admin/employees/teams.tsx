'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CornerDownRight, FolderPlus, Network, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export interface OrgUnitRow {
  id: string;
  name: string;
  parentId: string | null;
  manager: { id: string; fullName: string; nickname: string | null } | null;
  memberCount: number;
  childCount: number;
  usage: { roleScopes: number; schedules: number; accounts: number };
}
interface EmployeeLite {
  id: string;
  fullName: string;
  nickname: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}
interface Draft {
  id?: string;
  name: string;
  parentId: string;
  managerId: string;
}

/** "ทีมบัญชี A › ทีมย่อย" — used wherever a team is picked from a dropdown. */
export function unitPath(units: { id: string; name: string; parentId: string | null }[], id: string): string {
  const byId = new Map(units.map((u) => [u.id, u]));
  const names: string[] = [];
  for (let u = byId.get(id), hops = 0; u && hops < units.length; u = u.parentId ? byId.get(u.parentId) : undefined, hops++) names.unshift(u.name);
  return names.join(' › ');
}

/** Units in tree order (parents first, children indented), for lists and dropdowns. */
export function treeOrder<T extends { id: string; name: string; parentId: string | null }>(units: T[]): { unit: T; depth: number }[] {
  const ids = new Set(units.map((u) => u.id));
  const children = new Map<string | null, T[]>();
  for (const u of units) {
    const key = u.parentId && ids.has(u.parentId) ? u.parentId : null;
    children.set(key, [...(children.get(key) ?? []), u]);
  }
  const out: { unit: T; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'th'))) {
      out.push({ unit: u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function descendantsOf(units: OrgUnitRow[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) if (u.parentId && out.has(u.parentId) && !out.has(u.id)) (out.add(u.id), (grew = true));
  }
  return out;
}

export function Teams() {
  const qc = useQueryClient();
  const units = useQuery({ queryKey: ['org-units'], queryFn: () => api<OrgUnitRow[]>('/org-units') });
  const employees = useQuery({ queryKey: ['admin-employees'], queryFn: () => api<EmployeeLite[]>('/employees') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['org-units'] });
    void qc.invalidateQueries({ queryKey: ['employee-options'] });
    void qc.invalidateQueries({ queryKey: ['admin-employees'] });
  };
  const save = useMutation({
    mutationFn: (d: Draft) =>
      api(d.id ? `/org-units/${d.id}` : '/org-units', {
        method: d.id ? 'PATCH' : 'POST',
        body: { name: d.name.trim(), parentId: d.parentId || null, managerId: d.managerId || null },
      }),
    onSuccess: () => {
      setDraft(null);
      refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/org-units/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });

  const open = (d: Draft) => {
    setError(null);
    setDraft(d);
  };
  const rows = treeOrder(units.data ?? []);
  const blocked = draft?.id ? descendantsOf(units.data ?? [], draft.id) : new Set<string>();
  const managers = (employees.data ?? []).filter((e) => e.status === 'ACTIVE');

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Network className="h-4 w-4 text-brand-600" /> ทีม
        </span>
      }
      description="ทีมและทีมย่อย (แทน team_table / subTeam_table เดิม) — หัวหน้าที่ดูแลทีมจะเห็นรายงานของทีมย่อยด้วย การย้ายทีมจึงเปลี่ยนสิทธิ์การเห็นข้อมูล และถูกบันทึกใน Audit log"
      actions={
        <Button size="sm" variant="primary" onClick={() => open({ name: '', parentId: '', managerId: '' })}>
          <Plus className="h-3.5 w-3.5" /> สร้างทีม
        </Button>
      }
      bodyClassName="p-0"
    >
      {error && !draft && (
        <div className="p-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {units.isLoading ? (
        <div className="p-5">
          <Loading rows={3} />
        </div>
      ) : units.error ? (
        <div className="p-5">
          <Alert tone="error">{errorMessage(units.error)}</Alert>
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-gray-500">ยังไม่มีทีม — กด “สร้างทีม” เพื่อเริ่ม</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map(({ unit: u, depth }) => {
            const empty = u.memberCount === 0 && u.childCount === 0 && !u.usage.roleScopes && !u.usage.schedules && !u.usage.accounts;
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-gray-50/60">
                <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: depth * 22 }}>
                  {depth > 0 && <CornerDownRight className="h-4 w-4 shrink-0 text-gray-300" aria-hidden />}
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-gray-900">{u.name}</p>
                    <p className="flex items-center gap-1 text-[12px] text-gray-500">
                      <UserRound className="h-3 w-3" aria-hidden />
                      {u.manager ? `หัวหน้า: ${u.manager.fullName}${u.manager.nickname ? ` (${u.manager.nickname})` : ''}` : 'ยังไม่ระบุหัวหน้าทีม'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge tone={u.memberCount ? 'brand' : 'gray'}>{u.memberCount} คน</Badge>
                  {u.childCount > 0 && <Badge tone="sky">{u.childCount} ทีมย่อย</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => open({ name: '', parentId: u.id, managerId: '' })} aria-label={`เพิ่มทีมย่อยใน ${u.name}`}>
                    <FolderPlus className="h-3.5 w-3.5" /> ทีมย่อย
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => open({ id: u.id, name: u.name, parentId: u.parentId ?? '', managerId: u.manager?.id ?? '' })} aria-label={`แก้ไขทีม ${u.name}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={empty ? 'text-rose-600' : 'text-gray-300'}
                    title={empty ? 'ลบทีม' : 'ลบได้เฉพาะทีมที่ไม่มีพนักงาน ทีมย่อย สิทธิ์ ตารางเวลา หรือบัญชีระบบอื่นผูกอยู่'}
                    onClick={() => {
                      setError(null);
                      if (window.confirm(`ลบทีม ${u.name}?`)) remove.mutate(u.id);
                    }}
                    aria-label={`ลบทีม ${u.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? `แก้ไขทีม ${units.data?.find((u) => u.id === draft.id)?.name ?? ''}` : draft?.parentId ? 'สร้างทีมย่อย' : 'สร้างทีม'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>ยกเลิก</Button>
            <Button variant="primary" loading={save.isPending} disabled={!draft?.name.trim()} onClick={() => draft && save.mutate(draft)}>
              บันทึก
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="ชื่อทีม">
              <input className={inputClass} autoFocus maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="อยู่ภายใต้ทีม" hint="เว้นว่าง = เป็นทีมหลัก">
              <select className={inputClass} value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
                <option value="">— เป็นทีมหลัก —</option>
                {rows
                  .filter(({ unit }) => !blocked.has(unit.id))
                  .map(({ unit, depth }) => (
                    <option key={unit.id} value={unit.id}>
                      {'  '.repeat(depth)}
                      {unit.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="หัวหน้าทีม" hint="หัวหน้าที่มีสิทธิ์ดูรายงานทีมจะเห็นพนักงานของทีมนี้และทีมย่อย">
              <select className={inputClass} value={draft.managerId} onChange={(e) => setDraft({ ...draft, managerId: e.target.value })}>
                <option value="">— ไม่ระบุ —</option>
                {managers.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                    {e.nickname ? ` (${e.nickname})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            {error && <Alert tone="error">{error}</Alert>}
          </>
        )}
      </Dialog>
    </Card>
  );
}
