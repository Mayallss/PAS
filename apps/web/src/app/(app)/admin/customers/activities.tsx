'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderTree, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CATEGORY_DOT, CATEGORY_LABEL } from '@/lib/format';
import type { WorkCategoryType } from '@/lib/types';

export interface Activity {
  id: string;
  name: string;
  type: WorkCategoryType;
  parentId: string | null;
  parent: { id: string; name: string } | null;
  isBillable: boolean;
  isActive: boolean;
  sortOrder: number;
  childCount: number;
  customerCount?: number;
}

type Draft = Omit<Activity, 'id' | 'parent' | 'childCount' | 'customerCount'> & { id?: string };
const EMPTY: Draft = { name: '', type: 'CLIENT_WORK', parentId: null, isBillable: true, isActive: true, sortOrder: 0 };

/** Catalogue of Activities (legacy job_table) — previously editable only directly in the database. */
export function Activities() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['work-categories'], queryFn: () => api<Activity[]>('/catalog/work-categories') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { id, ...body } = d;
      return api(id ? `/catalog/work-categories/${id}` : '/catalog/work-categories', { method: id ? 'PUT' : 'POST', body });
    },
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['work-categories'] });
      void qc.invalidateQueries({ queryKey: ['admin-engagements'] });
      void qc.invalidateQueries({ queryKey: ['task-search'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const all = q.data ?? [];
  const groups = all.filter((a) => !a.parentId && a.childCount > 0);
  const visible = all.filter((a) => showInactive || a.isActive);
  const sections = [
    ...groups.map((g) => ({ group: g, items: visible.filter((a) => a.parentId === g.id) })),
    { group: null, items: visible.filter((a) => !a.parentId && a.childCount === 0) },
  ].filter((s) => s.items.length || s.group);

  const open = (d: Draft) => {
    setError(null);
    setDraft(d);
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-brand-600" /> Activity ทั้งหมด
        </span>
      }
      description="ประเภทงานที่ใช้ลงเวลา (ระบบเดิม: job_table) จัดเป็นกลุ่มได้ 1 ระดับ — ปิดใช้งานแล้วข้อมูลเวลาเดิมยังอยู่ครบ"
      actions={
        <>
          <label className="flex items-center gap-1.5 text-[13px] text-gray-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> แสดงที่ปิดแล้ว
          </label>
          <Button size="sm" onClick={() => open({ ...EMPTY, type: 'CLIENT_WORK', isBillable: false })}>
            <Plus className="h-3.5 w-3.5" /> สร้างกลุ่ม
          </Button>
          <Button size="sm" variant="primary" onClick={() => open({ ...EMPTY, parentId: groups[0]?.id ?? null })}>
            <Plus className="h-3.5 w-3.5" /> เพิ่ม Activity
          </Button>
        </>
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <div className="p-5"><Loading rows={4} /></div>
      ) : !all.length ? (
        <Empty title="ยังไม่มี Activity" />
      ) : (
        <div className="divide-y divide-gray-100">
          {sections.map(({ group, items }) => (
            <div key={group?.id ?? 'ungrouped'}>
              <div className="flex items-center justify-between bg-gray-50/80 px-5 py-2">
                <p className="text-[12px] font-semibold text-gray-600">
                  {group ? group.name : 'ไม่อยู่ในกลุ่ม'}
                  {group && !group.isActive && <Badge>ปิดแล้ว</Badge>}
                </p>
                {group && (
                  <Button size="sm" variant="ghost" aria-label={`แก้ไขกลุ่ม ${group.name}`} onClick={() => open({ ...group })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <ul className="divide-y divide-gray-100">
                {items.map((a) => (
                  <li key={a.id} className={`flex items-center gap-3 px-5 py-2.5 text-[13px] ${a.isActive ? '' : 'opacity-50'}`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[a.type]}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-gray-900">{a.name}</span>
                    <span className="hidden text-[12px] text-gray-500 sm:inline">{CATEGORY_LABEL[a.type]}</span>
                    {a.isBillable ? <Badge tone="brand">คิดค่าบริการ</Badge> : <Badge>ภายใน</Badge>}
                    {!a.isActive && <Badge tone="rose">ปิดแล้ว</Badge>}
                    <span className="w-20 text-right text-[12px] text-gray-400">{a.customerCount ?? 0} ลูกค้า</span>
                    <Button size="sm" variant="ghost" aria-label={`แก้ไข ${a.name}`} onClick={() => open({ ...a })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? `แก้ไข: ${draft.name}` : 'เพิ่ม Activity'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>ยกเลิก</Button>
            <Button variant="primary" loading={save.isPending} disabled={!draft?.name.trim()} onClick={() => draft && save.mutate(draft)}>บันทึก</Button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="ชื่อ">
              <input className={inputClass} maxLength={150} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="เช่น ปิดบัญชี - รายปี" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="กลุ่ม">
                <select className={inputClass} value={draft.parentId ?? ''} onChange={(e) => setDraft({ ...draft, parentId: e.target.value || null })}>
                  <option value="">— ไม่มี (เป็นกลุ่ม / รายการระดับบน) —</option>
                  {all
                    .filter((a) => !a.parentId && a.id !== draft.id)
                    .map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
              </Field>
              <Field label="ประเภท">
                <select className={inputClass} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as WorkCategoryType })}>
                  {(Object.keys(CATEGORY_LABEL) as WorkCategoryType[]).map((t) => (
                    <option key={t} value={t}>{CATEGORY_LABEL[t]}</option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={draft.isBillable} onChange={(e) => setDraft({ ...draft, isBillable: e.target.checked })} /> คิดค่าบริการลูกค้าได้ (billable)
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> เปิดใช้งาน (ปิด = ไม่แสดงให้เลือกลงเวลา แต่ข้อมูลเดิมยังอยู่)
            </label>
            {error && <Alert tone="error">{error}</Alert>}
          </>
        )}
      </Dialog>
    </Card>
  );
}
