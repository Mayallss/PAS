'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { mondayOf } from '@/lib/format';
import type { PlanWeek, Task, TeamPlan, TodoItem, TodoPriority, TodoStatus } from '@/lib/types';

export const planKey = (employeeId: string | undefined, date: string): QueryKey => ['plan', employeeId ?? 'me', mondayOf(date)];

export function usePlanWeek(date: string, employeeId: string | undefined, initial?: PlanWeek) {
  const key = planKey(employeeId, date);
  const initialMatches = !!initial && initial.weekStart === mondayOf(date) && (employeeId ? initial.employee.id === employeeId : initial.own);
  return useQuery({
    queryKey: key,
    queryFn: () => api<PlanWeek>('/todos/week', { query: { date, employeeId } }),
    initialData: initialMatches ? initial : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useTeamPlan(date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['plan-team', mondayOf(date)],
    queryFn: () => api<TeamPlan>('/todos/team', { query: { date } }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export interface ItemPatch {
  title?: string;
  workDate?: string;
  plannedMinutes?: number | null;
  note?: string | null;
  priority?: TodoPriority;
  status?: TodoStatus;
}

/**
 * Every change shows immediately (optimistic) and is rolled back with a message if the server refuses
 * (locked month, lead-assigned item, someone else edited it first).
 */
export function usePlanMutations(key: QueryKey, employeeId: string | undefined) {
  const qc = useQueryClient();
  const snapshot = () => qc.getQueryData<PlanWeek>(key);
  const setItems = (fn: (items: TodoItem[]) => TodoItem[]) =>
    qc.setQueryData<PlanWeek>(key, (w) => (w ? { ...w, items: fn(w.items) } : w));
  const settle = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['plan-team'] });
  };
  const rollback = (prev: PlanWeek | undefined, e: unknown) => {
    if (prev) qc.setQueryData(key, prev);
    toast.error(errorMessage(e));
  };

  const create = useMutation({
    /** Either a task (customer Activity + hours) or a custom item (free text, hours optional). */
    mutationFn: (v: { task?: Task; title?: string; workDate: string; plannedMinutes: number | null; priority?: TodoPriority; note?: string | null }) =>
      api<{ id: string; version: number }>('/todos', {
        method: 'POST',
        body: {
          employeeId,
          ...(v.task ? { engagementId: v.task.engagementId } : { title: v.title }),
          workDate: v.workDate,
          plannedMinutes: v.plannedMinutes,
          priority: v.priority,
          note: v.note ?? null,
        },
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = snapshot();
      const temp: TodoItem = {
        id: `temp-${Math.random().toString(36).slice(2)}`,
        kind: v.task ? 'TASK' : 'CUSTOM',
        task: v.task ?? null,
        title: v.task ? null : (v.title ?? null),
        workDate: v.workDate,
        plannedMinutes: v.plannedMinutes,
        actualMinutes: 0,
        taskDayPlannedMinutes: v.task ? v.plannedMinutes : null,
        note: v.note ?? null,
        priority: v.priority ?? 'MEDIUM',
        status: 'PLANNED',
        late: false,
        assignedBy: null,
        version: 1,
      };
      setItems((items) => [...items, temp]);
      return { prev, tempId: temp.id };
    },
    onSuccess: (res, _v, ctx) => setItems((items) => items.map((i) => (i.id === ctx?.tempId ? { ...i, id: res.id, version: res.version } : i))),
    onError: (e, _v, ctx) => rollback(ctx?.prev, e),
    onSettled: settle,
  });

  const update = useMutation({
    mutationFn: ({ item, patch }: { item: TodoItem; patch: ItemPatch }) =>
      api<{ id: string; version: number }>(`/todos/${item.id}`, { method: 'PATCH', body: { expectedVersion: item.version, ...patch } }),
    onMutate: async ({ item, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = snapshot();
      setItems((items) =>
        items.map((i) => {
          if (i.id === item.id) {
            const next = { ...i, ...patch, late: false };
            return item.kind === 'TASK' && typeof patch.plannedMinutes === 'number'
              ? { ...next, taskDayPlannedMinutes: (i.taskDayPlannedMinutes ?? 0) - (i.plannedMinutes ?? 0) + patch.plannedMinutes }
              : next;
          }
          const sameCell = item.kind === 'TASK' && i.task?.engagementId === item.task?.engagementId && i.workDate === item.workDate;
          return sameCell && typeof patch.plannedMinutes === 'number'
            ? { ...i, taskDayPlannedMinutes: (i.taskDayPlannedMinutes ?? 0) - (item.plannedMinutes ?? 0) + patch.plannedMinutes }
            : i;
        }),
      );
      return { prev };
    },
    onSuccess: (res) => setItems((items) => items.map((i) => (i.id === res.id ? { ...i, version: res.version } : i))),
    onError: (e, _v, ctx) => rollback(ctx?.prev, e),
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: (item: TodoItem) => api(`/todos/${item.id}`, { method: 'DELETE', query: { version: item.version } }),
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = snapshot();
      setItems((items) => items.filter((i) => i.id !== item.id));
      return { prev };
    },
    onError: (e, _v, ctx) => rollback(ctx?.prev, e),
    onSettled: settle,
  });

  const carryOver = useMutation({
    mutationFn: (toDate: string) => api<{ moved: number; skippedLocked: number }>('/todos/carry-over', { method: 'POST', body: { toDate, employeeId } }),
    onSuccess: (r) => {
      toast.success(r.moved ? `ย้ายงานค้าง ${r.moved} รายการมาแล้ว` : 'ไม่มีงานค้างที่ย้ายได้');
      void qc.invalidateQueries({ queryKey: ['plan'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['plan-team'] }),
  });

  return { create, update, remove, carryOver };
}
