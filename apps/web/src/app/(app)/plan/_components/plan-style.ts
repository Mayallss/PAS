import type { TodoItem, TodoPriority, TodoStatus } from '@/lib/types';

export const PRIORITY: Record<TodoPriority, { label: string; bar: string; chip: string }> = {
  URGENT: { label: 'สำคัญมาก', bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-200' },
  HIGH: { label: 'สูง', bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  MEDIUM: { label: 'ปานกลาง', bar: 'bg-brand-400', chip: 'bg-brand-50 text-brand-700 ring-brand-200' },
  LOW: { label: 'ต่ำ', bar: 'bg-gray-300', chip: 'bg-gray-50 text-gray-600 ring-gray-200' },
};
export const PRIORITY_ORDER: TodoPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export const STATUS: Record<TodoStatus, { label: string; chip: string }> = {
  PLANNED: { label: 'ยังไม่เริ่ม', chip: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { label: 'กำลังทำ', chip: 'bg-sky-50 text-sky-700' },
  DONE: { label: 'เสร็จแล้ว', chip: 'bg-emerald-50 text-emerald-700' },
  CANCELLED: { label: 'ยกเลิก', chip: 'bg-gray-100 text-gray-400' },
};
export const STATUS_ORDER: TodoStatus[] = ['PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

export const isOpen = (i: Pick<TodoItem, 'status'>) => i.status === 'PLANNED' || i.status === 'IN_PROGRESS';
/** Derived like the server: unfinished and its day has passed. Recomputed locally so optimistic moves update at once. */
export const isLate = (i: Pick<TodoItem, 'status' | 'workDate'>, today: string) => isOpen(i) && i.workDate < today;

/** Sort inside a day: open first (by priority), then done, then cancelled. */
export function sortItems(items: TodoItem[]): TodoItem[] {
  const rank = (i: TodoItem) => (i.status === 'CANCELLED' ? 3 : i.status === 'DONE' ? 2 : 0) * 10 + PRIORITY_ORDER.indexOf(i.priority);
  return [...items].sort((a, b) => rank(a) - rank(b));
}

export const hrs = (m: number) => {
  const h = Math.round((m / 60) * 100) / 100;
  return `${h} ชม.`;
};

export const baht = (n: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(n);
