'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { History, Loader2, Plus, Search, StickyNote } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { CATEGORY_DOT } from '@/lib/format';
import type { Task } from '@/lib/types';

const groupHeading = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-gray-400';

/** Search box (44px) + list padding; the list itself gets whatever height remains. */
const CHROME = 56;
const MAX_LIST = 320;
const GAP = 4;
const EDGE = 12;

interface Placement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  listMax: number;
}

/**
 * Anchor the panel to the button in viewport coordinates. It is rendered in a portal because the
 * week grid scrolls horizontally (overflow-x: auto also clips vertically), which used to cut the
 * list off below the grid's edge. Opens upwards when there is not enough room below.
 */
function place(anchor: HTMLElement): Placement {
  const r = anchor.getBoundingClientRect();
  const width = Math.min(448, window.innerWidth - EDGE * 2);
  const left = Math.min(Math.max(EDGE, r.left), window.innerWidth - width - EDGE);
  const below = window.innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const needed = CHROME + 200;
  if (below >= needed || below >= above) return { left, width, top: r.bottom + GAP, listMax: Math.max(120, Math.min(MAX_LIST, below - CHROME)) };
  return { left, width, bottom: window.innerHeight - r.top + GAP, listMax: Math.max(120, Math.min(MAX_LIST, above - CHROME)) };
}

function TaskItem({ task, onSelect, icon }: { task: Task; onSelect: () => void; icon?: React.ReactNode }) {
  return (
    <Command.Item
      value={task.engagementId}
      keywords={[task.customer.code, task.customer.name, task.workCategory.name, task.workCategory.group ?? '']}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 data-[selected=true]:bg-brand-50"
    >
      {icon ?? <span className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[task.workCategory.type]}`} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-gray-900">
          <span className="font-mono text-[12px] text-gray-500">{task.customer.code}</span> {task.customer.name}
        </p>
        <p className="truncate text-[12px] text-gray-500">{task.workCategory.group ? `${task.workCategory.group} › ` : ''}{task.workCategory.name}</p>
      </div>
    </Command.Item>
  );
}

/** One-step picker: search customer + task together ("A001 ปิดบัญชี"), recent tasks shown first. */
export function AddTask({
  recent,
  exclude,
  onAdd,
  autoOpen = false,
  label = 'เพิ่ม Activity',
  className = 'flex h-10 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-brand-700 hover:bg-brand-50',
  onCreateCustom,
}: {
  recent: Task[];
  exclude: Set<string>;
  onAdd: (task: Task) => void;
  autoOpen?: boolean;
  label?: string;
  className?: string;
  /** When set, the typed text can be added as a free-text item that is not an Activity (work plan only). */
  onCreateCustom?: (title: string) => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<Placement | null>(null);
  const deferred = useDeferredValue(q.trim());
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const search = useQuery({
    queryKey: ['task-search', deferred],
    queryFn: () => api<Task[]>('/catalog/engagements/search', { query: { q: deferred, limit: 30 } }),
    enabled: open && deferred.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const reposition = useCallback(() => {
    if (anchor.current) setPos(place(anchor.current));
  }, []);

  // Position before paint, then follow the button while anything scrolls (the grid scrolls sideways) or the window resizes.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (t: Task) => {
    setOpen(false);
    setQ('');
    onAdd(t);
  };
  const pickCustom = () => {
    const title = q.trim();
    if (!title || !onCreateCustom) return;
    setOpen(false);
    setQ('');
    onCreateCustom(title);
  };
  const customRow = onCreateCustom && q.trim() && (
    <Command.Group heading="งานอื่น (ไม่ผูก Activity — ไม่นับในประมาณการ)" className={groupHeading}>
      <Command.Item
        value="__custom__"
        onSelect={pickCustom}
        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 data-[selected=true]:bg-amber-50"
      >
        <StickyNote className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-900">
          เพิ่มเป็นงานอื่น: <span className="font-medium">“{q.trim()}”</span>
        </span>
      </Command.Item>
    </Command.Group>
  );
  const recentAvailable = recent.filter((t) => !exclude.has(t.engagementId));
  const results = (search.data ?? []).filter((t) => !exclude.has(t.engagementId));

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={className}
      >
        <Plus className="h-4 w-4" aria-hidden /> {label}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
            className="z-50 animate-pop-in overflow-hidden rounded-xl bg-white shadow-pop ring-1 ring-gray-200"
          >
            <Command
              shouldFilter={false}
              label="เลือก Activity"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                  anchor.current?.focus();
                }
                // Enter with no Activity highlighted (e.g. nothing matched) adds the typed text as a custom item.
                if (e.key === 'Enter' && onCreateCustom && q.trim() && !panel.current?.querySelector('[cmdk-item][data-selected="true"]')) {
                  e.preventDefault();
                  pickCustom();
                }
              }}
            >
              <div className="flex items-center gap-2 border-b border-gray-100 px-3">
                {search.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : <Search className="h-4 w-4 text-gray-400" />}
                <Command.Input autoFocus value={q} onValueChange={setQ} placeholder={onCreateCustom ? 'ค้นหาลูกค้า/Activity หรือพิมพ์งานอื่น…' : 'ค้นหารหัสลูกค้า (JOB) ชื่อบริษัท หรือ Activity…'} className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400" />
              </div>
              <Command.List className="overflow-y-auto overscroll-contain p-1.5" style={{ maxHeight: pos.listMax }}>
                {deferred === '' ? (
                  recentAvailable.length ? (
                    <Command.Group heading="ใช้ล่าสุด" className={groupHeading}>
                      {recentAvailable.map((t) => (
                        <TaskItem key={t.engagementId} task={t} onSelect={() => pick(t)} icon={<History className="h-3.5 w-3.5 shrink-0 text-gray-400" />} />
                      ))}
                    </Command.Group>
                  ) : (
                    <p className="px-3 py-6 text-center text-[13px] text-gray-500">พิมพ์เพื่อค้นหา Activity จากลูกค้าทั้งหมด เช่น “A001 ปิดบัญชี”</p>
                  )
                ) : results.length ? (
                  <>
                    <Command.Group heading="ผลการค้นหา" className={groupHeading}>
                      {results.map((t) => (
                        <TaskItem key={t.engagementId} task={t} onSelect={() => pick(t)} />
                      ))}
                    </Command.Group>
                    {customRow}
                  </>
                ) : (
                  <>
                    {!search.isFetching && !onCreateCustom && <p className="px-3 py-6 text-center text-[13px] text-gray-500">ไม่พบ Activity ที่ตรงกับ “{deferred}”</p>}
                    {!search.isFetching && onCreateCustom && <p className="px-3 pt-3 pb-1 text-[12px] text-gray-500">ไม่พบ Activity ที่ตรงกับ “{deferred}”</p>}
                    {customRow}
                  </>
                )}
              </Command.List>
            </Command>
          </div>,
          document.body,
        )}
    </>
  );
}
