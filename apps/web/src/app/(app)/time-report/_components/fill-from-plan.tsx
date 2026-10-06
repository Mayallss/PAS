'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, ListTodo } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Button, Dialog, Empty, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { mondayOf, parseDuration, THAI_WEEKDAY_SHORT, thaiDateShort } from '@/lib/format';
import type { PlanWeek } from '@/lib/types';

interface Candidate {
  key: string;
  engagementId: string;
  workDate: string;
  weekday: number;
  label: string;
  activity: string;
  plannedMinutes: number;
  description: string | null;
}

/**
 * Plan → actual, confirmed by the person (decision 2026-09-29): lists planned work for days up to today
 * that has no time logged yet. Nothing is copied automatically, and existing cells are never overwritten.
 */
export function FillFromPlan({ date, today }: { date: string; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <ListTodo className="h-4 w-4" /> เติมจากแผน
      </Button>
      {open && <FillDialog date={date} today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function FillDialog({ date, today, onClose }: { date: string; today: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plan', 'me', mondayOf(date)], queryFn: () => api<PlanWeek>('/todos/week', { query: { date } }), staleTime: 0 });

  const candidates = useMemo<Candidate[]>(() => {
    const plan = q.data;
    if (!plan) return [];
    const lockedOrFuture = new Set(plan.days.filter((d) => d.locked || d.date > today).map((d) => d.date));
    const weekdayOf = new Map(plan.days.map((d) => [d.date, d.weekday]));
    const groups = new Map<string, Candidate>();
    for (const i of plan.items) {
      // Custom items are personal notes, not work to log.
      if (!i.task || !i.plannedMinutes || i.status === 'CANCELLED' || i.actualMinutes > 0 || lockedOrFuture.has(i.workDate)) continue;
      const key = `${i.task.engagementId}|${i.workDate}`;
      const g = groups.get(key);
      if (g) {
        g.plannedMinutes += i.plannedMinutes;
        if (i.note) g.description = g.description ? `${g.description}; ${i.note}` : i.note;
      } else {
        groups.set(key, {
          key,
          engagementId: i.task.engagementId,
          workDate: i.workDate,
          weekday: weekdayOf.get(i.workDate) ?? 1,
          label: `${i.task.customer.code} ${i.task.customer.name}`,
          activity: i.task.workCategory.name,
          plannedMinutes: i.plannedMinutes,
          description: i.note,
        });
      }
    }
    return [...groups.values()].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.label.localeCompare(b.label));
  }, [q.data, today]);

  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const minutesOf = (c: Candidate) => (edits[c.key] === undefined ? c.plannedMinutes : parseDuration(edits[c.key]));
  const chosen = candidates.filter((c) => !unchecked.has(c.key));
  const invalid = chosen.some((c) => {
    const m = minutesOf(c);
    return m === null || Number.isNaN(m) || m <= 0;
  });

  const fill = useMutation({
    mutationFn: () =>
      api<{ created: number; results: { engagementId: string; workDate: string; result: string; message?: string }[] }>('/time-report/fill-from-plan', {
        method: 'POST',
        body: { items: chosen.map((c) => ({ engagementId: c.engagementId, workDate: c.workDate, durationMinutes: minutesOf(c), description: c.description })) },
      }),
    onSuccess: (r) => {
      const rejected = r.results.filter((x) => x.result === 'REJECTED');
      const skipped = r.results.filter((x) => x.result === 'SKIPPED_EXISTS').length;
      if (r.created) toast.success(`ลงเวลาจากแผนแล้ว ${r.created} รายการ`);
      if (skipped) toast.info(`ข้าม ${skipped} รายการที่มีเวลาอยู่แล้ว`);
      for (const x of rejected) toast.error(`${thaiDateShort(x.workDate)}: ${x.message}`);
      void qc.invalidateQueries({ queryKey: ['week'] });
      void qc.invalidateQueries({ queryKey: ['month-summary'] });
      void qc.invalidateQueries({ queryKey: ['plan'] });
      if (!rejected.length) onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="เติมเวลาจากแผนงาน"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={fill.isPending} disabled={!chosen.length || invalid} onClick={() => fill.mutate()}>
            <ClipboardCheck className="h-4 w-4" /> ลงเวลา {chosen.length} รายการ
          </Button>
        </>
      }
    >
      <p className="-mt-1 text-[13px] text-gray-500">
        เลือกงานที่ทำจริงตามแผน แก้ชั่วโมงให้ตรงกับที่ทำจริงได้ก่อนบันทึก — รายการที่ลงเวลาไว้แล้วจะไม่ถูกเขียนทับ
      </p>
      {q.isLoading ? (
        <Loading rows={3} />
      ) : q.error ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : candidates.length === 0 ? (
        <Empty icon={<ListTodo className="h-6 w-6" />} title="ไม่มีงานในแผนที่รอลงเวลา">
          งานในแผนของวันที่ผ่านมาลงเวลาครบแล้ว หรือยังไม่ได้วางแผน —{' '}
          <Link href={`/plan?date=${date}`} className="text-brand-700 underline">
            ไปที่แผนงาน
          </Link>
        </Empty>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg ring-1 ring-gray-200">
          {candidates.map((c) => {
            const on = !unchecked.has(c.key);
            const m = minutesOf(c);
            const bad = on && (m === null || Number.isNaN(m) || m <= 0);
            return (
              <li key={c.key} className={`flex items-center gap-3 px-3 py-2.5 ${on ? '' : 'opacity-50'}`}>
                <input
                  type="checkbox"
                  aria-label={`ลงเวลา ${c.label} ${c.activity}`}
                  checked={on}
                  onChange={(e) =>
                    setUnchecked((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.delete(c.key);
                      else n.add(c.key);
                      return n;
                    })
                  }
                  className="h-4 w-4 accent-brand-600"
                />
                <span className="w-16 shrink-0 text-[12px] text-gray-500">
                  {THAI_WEEKDAY_SHORT[c.weekday]} {Number(c.workDate.slice(8))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-gray-900">{c.label}</span>
                  <span className="block truncate text-[12px] text-gray-500">{c.activity}</span>
                </span>
                <input
                  aria-label="ชั่วโมงจริง"
                  inputMode="decimal"
                  disabled={!on}
                  className={`${inputClass} h-8 w-20 text-right tabular-nums ${bad ? 'ring-rose-400' : ''}`}
                  value={edits[c.key] ?? String(c.plannedMinutes / 60)}
                  onChange={(e) => setEdits((x) => ({ ...x, [c.key]: e.target.value }))}
                />
                <span className="w-7 text-[12px] text-gray-500">ชม.</span>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
