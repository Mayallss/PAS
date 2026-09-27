'use client';

import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/lib/api';
import { addDays, hours, mondayOf, shiftMonth } from '@/lib/format';
import type { DayStatus, Entry, MonthSummary, Task, WeekRow, WeekView } from '@/lib/types';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const weekKey = (employeeId: string | undefined, date: string) => ['week', employeeId ?? 'me', mondayOf(date)] as const;
export const monthKey = (employeeId: string | undefined, month: string) => ['month-summary', employeeId ?? 'me', month] as const;

const fetchWeek = (date: string, employeeId?: string) => api<WeekView>('/time-report/week', { query: { date, employeeId } });
const fetchMonth = (month: string, employeeId?: string) => api<MonthSummary>('/time-report/month-summary', { query: { month, employeeId } });

const STALE = 30_000;

/** Week data with server-rendered initial data, instant switching (previous data kept) and neighbour prefetch. */
export function useWeek(date: string, employeeId: string | undefined, initial?: WeekView) {
  const qc = useQueryClient();
  const key = weekKey(employeeId, date);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchWeek(date, employeeId),
    initialData: initial && initial.weekStart === key[2] ? initial : undefined,
    initialDataUpdatedAt: initial ? Date.now() : undefined,
    placeholderData: keepPreviousData,
    staleTime: STALE,
  });
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return;
    // Prefetch previous/next week while the user reads this one → navigation feels instant.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    idle(() => {
      for (const d of [addDays(key[2], -7), addDays(key[2], 7)]) {
        void qc.prefetchQuery({ queryKey: weekKey(employeeId, d), queryFn: () => fetchWeek(d, employeeId), staleTime: STALE });
      }
    });
  }, [query.data, query.isPlaceholderData, key[2], employeeId, qc]); // eslint-disable-line react-hooks/exhaustive-deps
  return query;
}

export function useMonth(month: string, employeeId: string | undefined, initial?: MonthSummary) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: monthKey(employeeId, month),
    queryFn: () => fetchMonth(month, employeeId),
    initialData: initial && initial.month === month ? initial : undefined,
    initialDataUpdatedAt: initial ? Date.now() : undefined,
    placeholderData: keepPreviousData,
    staleTime: STALE,
  });
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return;
    for (const m of [shiftMonth(month, -1), shiftMonth(month, 1)]) {
      void qc.prefetchQuery({ queryKey: monthKey(employeeId, m), queryFn: () => fetchMonth(m, employeeId), staleTime: STALE });
    }
  }, [query.data, query.isPlaceholderData, month, employeeId, qc]);
  return query;
}

// ---------------------------------------------------------------------------
// Derived totals (mirrors the API's rules so optimistic updates stay consistent)
// ---------------------------------------------------------------------------

export function statusFor(total: number, required: number): DayStatus {
  if (required <= 0) return total > 0 ? 'COMPLETE' : 'OFF';
  if (total <= 0) return 'EMPTY';
  if (total < required) return 'UNDER';
  return total === required ? 'COMPLETE' : 'OVER';
}

const live = (e: Entry | undefined) => (e && !e.deleted ? e.durationMinutes : 0);

function recompute(view: WeekView): WeekView {
  const rows = view.rows.map((r) => ({ ...r, totalMinutes: Object.values(r.cells).reduce((a, c) => a + live(c), 0) }));
  const days = view.days.map((d) => {
    const totalMinutes = rows.reduce((a, r) => a + live(r.cells[d.date]), 0);
    return { ...d, totalMinutes, status: statusFor(totalMinutes, d.requiredMinutes) };
  });
  return { ...view, rows, days, totals: { ...view.totals, recordedMinutes: days.reduce((a, d) => a + d.totalMinutes, 0) } };
}

function patchCell(view: WeekView, task: Task, date: string, fn: (cell: Entry | undefined) => Entry | undefined): WeekView {
  let rows = view.rows;
  if (!rows.some((r) => r.engagementId === task.engagementId)) {
    rows = [...rows, { ...task, cells: {}, totalMinutes: 0, carried: false } satisfies WeekRow];
  }
  rows = rows.map((r) => {
    if (r.engagementId !== task.engagementId) return r;
    const cells = { ...r.cells };
    const next = fn(cells[date]);
    if (next) cells[date] = next;
    else delete cells[date];
    return { ...r, cells, carried: false };
  });
  return recompute({ ...view, rows });
}

const savedOf = (e: Entry | undefined) =>
  e && e.id ? (e.saved !== undefined ? e.saved : { durationMinutes: e.durationMinutes, description: e.description }) : null;

// ---------------------------------------------------------------------------
// Sync status (tiny external store → header indicator without re-rendering the grid)
// ---------------------------------------------------------------------------

let pendingCount = 0;
let lastSavedAt: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const syncStore = {
  subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
  snapshot: () => `${pendingCount}|${lastSavedAt ?? ''}`,
};
export function useSyncStatus() {
  const snap = useSyncExternalStore(syncStore.subscribe, syncStore.snapshot, () => '0|');
  const [p, t] = snap.split('|');
  return { pending: Number(p), lastSavedAt: t ? Number(t) : null };
}

// ---------------------------------------------------------------------------
// Mutations: optimistic, serialised per cell, rolled back on failure
// ---------------------------------------------------------------------------

export interface SaveInput {
  task: Task;
  date: string;
  /** null = delete the entry */
  minutes: number | null;
  description?: string | null;
}

export function useCellSaver(key: readonly unknown[]) {
  const qc = useQueryClient();
  const queues = useRef(new Map<string, Promise<void>>());

  const save = useCallback(
    (input: SaveInput, opts: { silent?: boolean } = {}) => {
      const cellKey = `${input.task.engagementId}|${input.date}`;
      const before = findCell(qc, key, input.task.engagementId, input.date);
      const description = input.description !== undefined ? input.description : (before?.description ?? null);

      // 1) Optimistic: the UI updates immediately.
      qc.setQueryData<WeekView>(key, (v) =>
        v &&
        patchCell(v, input.task, input.date, (cell) =>
          input.minutes === null
            ? // Keep a tombstone even for a not-yet-created cell: a create may still be queued ahead of this delete.
              cell && { ...cell, deleted: true, pending: true, saved: savedOf(cell) }
            : {
                id: cell?.id ?? '',
                engagementId: input.task.engagementId,
                workDate: input.date,
                durationMinutes: input.minutes,
                description,
                status: cell?.status ?? 'DRAFT',
                version: cell?.version ?? 0,
                updatedAt: cell?.updatedAt,
                saved: savedOf(cell),
                pending: true,
              },
        ),
      );
      pendingCount++;
      emit();

      // 2) Server write, strictly in order per cell so versions never race.
      const run = async () => {
        const cell = findCell(qc, key, input.task.engagementId, input.date);
        // A newer edit to this cell superseded a queued delete (e.g. undo) — nothing to delete anymore.
        if (input.minutes === null && cell && !cell.deleted) {
          pendingCount--;
          emit();
          return;
        }
        try {
          if (input.minutes === null) {
            if (cell?.id) await api(`/time-report/entries/${cell.id}`, { method: 'DELETE', query: { version: cell.version } });
            qc.setQueryData<WeekView>(key, (v) => v && patchCell(v, input.task, input.date, (c) => (c?.deleted ? undefined : c)));
            if (!opts.silent && before && !before.deleted) {
              toast('ลบรายการแล้ว', {
                description: `${input.task.customer.code} · ${hours(before.durationMinutes)} ชม.`,
                duration: 8000,
                action: { label: 'เลิกทำ', onClick: () => save({ ...input, minutes: before.durationMinutes, description: before.description }, { silent: true }) },
              });
            }
          } else {
            const res = await api<Entry>('/time-report/entries', {
              method: 'PUT',
              body: {
                engagementId: input.task.engagementId,
                workDate: input.date,
                durationMinutes: input.minutes,
                description: description?.trim() || null,
                ...(cell?.id ? { expectedVersion: cell.version } : {}),
              },
            });
            qc.setQueryData<WeekView>(key, (v) =>
              v &&
              patchCell(v, input.task, input.date, (c) =>
                c && { ...c, id: res.id, version: res.version, status: res.status, updatedAt: res.updatedAt, saved: { durationMinutes: res.durationMinutes, description: res.description }, pending: c.durationMinutes !== res.durationMinutes || c.description !== res.description },
              ),
            );
          }
          lastSavedAt = Date.now();
        } catch (e) {
          // 3) Roll back this cell to its last confirmed state.
          qc.setQueryData<WeekView>(key, (v) =>
            v &&
            patchCell(v, input.task, input.date, (c) => {
              const saved = c ? savedOf(c) : null;
              return saved && c?.id ? { ...c, ...saved, deleted: false, pending: false } : undefined;
            }),
          );
          toast.error(errorMessage(e));
          if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: key });
        } finally {
          pendingCount--;
          emit();
        }
      };
      const prev = queues.current.get(cellKey) ?? Promise.resolve();
      const next = prev.then(run);
      queues.current.set(cellKey, next);
      void next.finally(() => {
        if (queues.current.get(cellKey) === next) queues.current.delete(cellKey);
        // Month totals shown elsewhere are now stale.
        void qc.invalidateQueries({ queryKey: ['month-summary'], refetchType: 'none' });
      });
    },
    [qc, key],
  );

  return save;
}

function findCell(qc: QueryClient, key: readonly unknown[], engagementId: string, date: string) {
  return qc.getQueryData<WeekView>(key)?.rows.find((r) => r.engagementId === engagementId)?.cells[date];
}
