'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { History, Loader2, Plus, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { CATEGORY_DOT } from '@/lib/format';
import type { Task } from '@/lib/types';

const groupHeading = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-gray-400';

function TaskItem({ task, onSelect, icon }: { task: Task; onSelect: () => void; icon?: React.ReactNode }) {
  return (
    <Command.Item
      value={task.engagementId}
      keywords={[task.customer.code, task.customer.name, task.workCategory.name]}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 data-[selected=true]:bg-brand-50"
    >
      {icon ?? <span className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[task.workCategory.type]}`} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-gray-900">
          <span className="font-mono text-[12px] text-gray-500">{task.customer.code}</span> {task.customer.name}
        </p>
        <p className="truncate text-[12px] text-gray-500">{task.workCategory.name}</p>
      </div>
    </Command.Item>
  );
}

/** One-step picker: search customer + task together ("A001 ปิดบัญชี"), recent tasks shown first. */
export function AddTask({ recent, exclude, onAdd, autoOpen = false }: { recent: Task[]; exclude: Set<string>; onAdd: (task: Task) => void; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q.trim());
  const box = useRef<HTMLDivElement>(null);

  const search = useQuery({
    queryKey: ['task-search', deferred],
    queryFn: () => api<Task[]>('/catalog/engagements/search', { query: { q: deferred, limit: 30 } }),
    enabled: open && deferred.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (t: Task) => {
    setOpen(false);
    setQ('');
    onAdd(t);
  };
  const recentAvailable = recent.filter((t) => !exclude.has(t.engagementId));
  const results = (search.data ?? []).filter((t) => !exclude.has(t.engagementId));

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-brand-700 hover:bg-brand-50"
      >
        <Plus className="h-4 w-4" aria-hidden /> เพิ่มงาน
      </button>
      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 w-[min(28rem,calc(100vw-3rem))] overflow-hidden rounded-xl bg-white shadow-pop ring-1 ring-gray-200">
          <Command shouldFilter={false} label="เลือกงาน" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
            <div className="flex items-center gap-2 border-b border-gray-100 px-3">
              {search.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : <Search className="h-4 w-4 text-gray-400" />}
              <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="ค้นหารหัสลูกค้า ชื่อบริษัท หรือชื่องาน…" className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400" />
            </div>
            <Command.List className="max-h-80 overflow-y-auto p-1.5">
              {deferred === '' ? (
                recentAvailable.length ? (
                  <Command.Group heading="ใช้ล่าสุด" className={groupHeading}>
                    {recentAvailable.map((t) => (
                      <TaskItem key={t.engagementId} task={t} onSelect={() => pick(t)} icon={<History className="h-3.5 w-3.5 shrink-0 text-gray-400" />} />
                    ))}
                  </Command.Group>
                ) : (
                  <p className="px-3 py-6 text-center text-[13px] text-gray-500">พิมพ์เพื่อค้นหางานจากลูกค้าทั้งหมด</p>
                )
              ) : results.length ? (
                <Command.Group heading="ผลการค้นหา" className={groupHeading}>
                  {results.map((t) => (
                    <TaskItem key={t.engagementId} task={t} onSelect={() => pick(t)} />
                  ))}
                </Command.Group>
              ) : (
                !search.isFetching && <p className="px-3 py-6 text-center text-[13px] text-gray-500">ไม่พบงานที่ตรงกับ “{deferred}”</p>
              )}
            </Command.List>
          </Command>
        </div>
      )}
    </div>
  );
}
