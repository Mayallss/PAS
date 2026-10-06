'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { Alert, Badge, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDate } from '@/lib/format';
import { EMPLOYMENT_LABEL, type QueueTask } from '@/lib/onboarding';
import { can, useSession } from '@/lib/session';
import { TaskRow } from './_components/task-row';

/** IT/Admin work queue: every open checklist, grouped by person, soonest due first. */
export default function OnboardingQueuePage() {
  const me = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['onboarding-tasks'], queryFn: () => api<QueueTask[]>('/onboarding/tasks') });

  const groups = new Map<string, QueueTask[]>();
  for (const t of q.data ?? []) groups.set(t.employee.id, [...(groups.get(t.employee.id) ?? []), t]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['onboarding-tasks'] });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="งานรับพนักงานใหม่"
        description="Checklist ที่ยังไม่เสร็จของทุกคน — เมื่อทำครบทุกข้อ รายการจะปิดเองและหายจากหน้านี้"
        actions={
          can(me, 'employee.admin') && (
            <Link href="/admin/employees/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
              <UserPlus className="h-4 w-4" /> เพิ่มพนักงานใหม่
            </Link>
          )
        }
      />
      {q.isLoading ? (
        <Loading rows={6} />
      ) : q.error ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : !groups.size ? (
        <Empty icon={<ListChecks className="h-5 w-5" />} title="ไม่มีงานค้าง">เพิ่มพนักงานใหม่แล้ว Checklist จะมาแสดงที่นี่</Empty>
      ) : (
        <div className="space-y-4">
          {[...groups.values()].map((tasks) => {
            const e = tasks[0].employee;
            const todo = tasks.filter((t) => t.status === 'TODO');
            const late = todo.filter((t) => t.overdue).length;
            return (
              <Card
                key={e.id}
                title={
                  <Link href={`/admin/employees/${e.id}`} className="hover:text-brand-700 hover:underline">
                    {e.fullName}{e.nickname && <span className="font-normal text-gray-500"> ({e.nickname})</span>}
                  </Link>
                }
                description={
                  <>
                    {e.employeeCode && <span className="font-mono">{e.employeeCode} · </span>}
                    {EMPLOYMENT_LABEL[e.employmentType]}
                    {e.startDate && <> · เริ่มงาน {thaiDate(e.startDate)}</>}
                  </>
                }
                actions={
                  <>
                    <Badge tone="gray">เหลือ {todo.length}/{tasks.length}</Badge>
                    {late > 0 && <Badge tone="rose">เลยกำหนด {late}</Badge>}
                  </>
                }
                bodyClassName="px-5 py-1"
              >
                <ul className="divide-y divide-gray-100">
                  {tasks.map((t) => <TaskRow key={t.id} task={t} overdue={t.overdue} onChanged={refresh} />)}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
