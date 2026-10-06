'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ChevronDown, GripVertical, House, Search, ShieldCheck, Star } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import type { AppLink } from '@/lib/types';
import { AppIcon } from './brand';
import { Kbd } from './ui';

const COLLAPSED_KEY = 'pas.sidebar.collapsed';
export const APPS_QUERY = ['apps'] as const;

/** Apps the sidebar can open (planned modules only appear on the home launcher). */
export const useApps = () =>
  useQuery({ queryKey: APPS_QUERY, queryFn: () => api<AppLink[]>('/apps'), staleTime: 5 * 60_000 });

function readCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** Longest matching internal URL wins, so /admin/employees/123 highlights "พนักงานและสิทธิ์" only. */
function activeKey(apps: AppLink[], pathname: string) {
  let best: AppLink | null = null;
  for (const a of apps) {
    if (a.kind !== 'INTERNAL' || !a.url) continue;
    if ((pathname === a.url || pathname.startsWith(`${a.url}/`)) && (!best || a.url.length > best.url!.length)) best = a;
  }
  return best?.key ?? null;
}

export function SidebarNav({ pathname, onOpenPalette }: { pathname: string; onOpenPalette: () => void }) {
  const qc = useQueryClient();
  const { data: all, isLoading } = useApps();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  useEffect(() => setCollapsed(readCollapsed()), []);

  const apps = (all ?? []).filter((a) => a.kind !== 'PLANNED' && a.url);
  const favorites = apps.filter((a) => a.favorite !== null).sort((a, b) => a.favorite! - b.favorite!);
  const groups = new Map<string, AppLink[]>();
  for (const a of apps.filter((x) => !x.isAdmin)) groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
  const admin = apps.filter((a) => a.isAdmin);
  const current = activeKey(apps, pathname);

  const save = useMutation({
    mutationFn: (keys: string[]) => api<AppLink[]>('/apps/favorites', { method: 'PUT', body: { keys } }),
    onMutate: async (keys) => {
      await qc.cancelQueries({ queryKey: APPS_QUERY });
      const before = qc.getQueryData<AppLink[]>(APPS_QUERY);
      qc.setQueryData<AppLink[]>(APPS_QUERY, (old) => old?.map((a) => ({ ...a, favorite: keys.includes(a.key) ? keys.indexOf(a.key) : null })));
      return { before };
    },
    onError: (e, _keys, ctx) => {
      if (ctx?.before) qc.setQueryData(APPS_QUERY, ctx.before);
      toast.error(errorMessage(e));
    },
    onSuccess: (fresh) => qc.setQueryData(APPS_QUERY, fresh),
  });
  const favKeys = favorites.map((f) => f.key);
  const toggleFavorite = (key: string) => save.mutate(favKeys.includes(key) ? favKeys.filter((k) => k !== key) : [...favKeys, key]);
  const moveFavorite = (from: string, to: string) => {
    if (from === to) return;
    const next = favKeys.filter((k) => k !== from);
    next.splice(next.indexOf(to), 0, from);
    save.mutate(next);
  };
  const toggleGroup = (name: string) => {
    const next = collapsed.includes(name) ? collapsed.filter((c) => c !== name) : [...collapsed, name];
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      /* private mode — remembering is only a convenience */
    }
  };

  const item = (a: AppLink, opts: { inFavorites?: boolean } = {}) => {
    const active = a.key === current;
    const external = a.kind === 'EXTERNAL';
    const pinned = a.favorite !== null;
    const cls = `flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${
      active ? 'bg-white font-medium text-gray-900 shadow-card ring-1 ring-gray-200' : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-900'
    }`;
    const content = (
      <>
        <AppIcon icon={a.icon} className={`h-4 w-4 shrink-0 ${active ? 'text-brand-600' : 'text-gray-400'}`} />
        <span className="truncate">{a.name}</span>
        {external && <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-300" aria-label="(เปิดแท็บใหม่)" />}
      </>
    );
    return (
      <li
        key={`${opts.inFavorites ? 'fav' : 'app'}-${a.key}`}
        className={`group flex items-center ${dragKey && opts.inFavorites ? 'cursor-grabbing' : ''}`}
        draggable={opts.inFavorites}
        onDragStart={
          opts.inFavorites
            ? (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', a.key); // Firefox won't start a drag without data
                setDragKey(a.key);
              }
            : undefined
        }
        // Keyboard / no-mouse reorder: Alt+↑ / Alt+↓ on a pinned item.
        onKeyDown={
          opts.inFavorites
            ? (e) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                const i = favKeys.indexOf(a.key);
                const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
                if (j < 0 || j >= favKeys.length) return;
                const next = [...favKeys];
                [next[i], next[j]] = [next[j], next[i]];
                save.mutate(next);
              }
            : undefined
        }
        title={opts.inFavorites ? 'ลากเพื่อจัดลำดับ หรือกด Alt+↑/↓' : undefined}
        onDragEnd={opts.inFavorites ? () => setDragKey(null) : undefined}
        onDragOver={opts.inFavorites ? (e) => e.preventDefault() : undefined}
        onDrop={opts.inFavorites ? () => dragKey && moveFavorite(dragKey, a.key) : undefined}
      >
        {opts.inFavorites && <GripVertical className="-ml-1 h-3.5 w-3.5 shrink-0 cursor-grab text-gray-300 opacity-0 group-hover:opacity-100" aria-hidden />}
        {external ? (
          <a href={a.url!} target="_blank" rel="noopener noreferrer" className={cls} title={a.description ?? undefined}>
            {content}
          </a>
        ) : (
          <Link href={a.url!} prefetch aria-current={active ? 'page' : undefined} className={cls} title={a.description ?? undefined}>
            {content}
          </Link>
        )}
        <button
          type="button"
          onClick={() => toggleFavorite(a.key)}
          aria-label={pinned ? `เอา ${a.name} ออกจากรายการโปรด` : `เพิ่ม ${a.name} ในรายการโปรด`}
          aria-pressed={pinned}
          className={`ml-0.5 shrink-0 rounded-md p-1 transition ${pinned ? 'text-amber-500' : 'text-gray-300 opacity-0 group-hover:opacity-100 focus:opacity-100'} hover:bg-gray-200/60`}
        >
          <Star className="h-3.5 w-3.5" fill={pinned ? 'currentColor' : 'none'} />
        </button>
      </li>
    );
  };

  const section = (name: string, list: AppLink[], icon?: React.ReactNode) => {
    const closed = collapsed.includes(name);
    return (
      <div key={name}>
        <button type="button" onClick={() => toggleGroup(name)} aria-expanded={!closed} className="mb-1 flex w-full items-center gap-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-gray-400 uppercase hover:text-gray-600">
          {icon}
          <span className="flex-1 text-left">{name}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${closed ? '-rotate-90' : ''}`} aria-hidden />
        </button>
        {!closed && <ul className="space-y-0.5">{list.map((a) => item(a))}</ul>}
      </div>
    );
  };

  return (
    <nav aria-label="เมนูหลัก" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-white px-2.5 text-[13px] text-gray-500 shadow-card ring-1 ring-gray-200 hover:text-gray-700"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1 text-left">ค้นหา / ไปที่…</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <ul className="space-y-0.5">
        <li>
          <Link
            href="/"
            aria-current={pathname === '/' ? 'page' : undefined}
            className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm ${pathname === '/' ? 'bg-white font-medium text-gray-900 shadow-card ring-1 ring-gray-200' : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-900'}`}
          >
            <House className={`h-4 w-4 ${pathname === '/' ? 'text-brand-600' : 'text-gray-400'}`} aria-hidden /> หน้าหลัก
          </Link>
        </li>
      </ul>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="กำลังโหลดเมนู">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-8" />)}
        </div>
      ) : (
        <>
          <div>
            <p className="mb-1 flex items-center gap-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">
              <Star className="h-3 w-3" aria-hidden /> รายการโปรด
            </p>
            {favorites.length ? (
              <ul className="space-y-0.5">{favorites.map((a) => item(a, { inFavorites: true }))}</ul>
            ) : (
              <p className="px-2.5 text-[12px] leading-snug text-gray-400">กด ☆ ที่เมนูด้านล่างเพื่อปักหมุดแอปที่ใช้บ่อย</p>
            )}
          </div>
          {[...groups.entries()].map(([name, list]) => section(name, list))}
          {!!admin.length && (
            <div className="border-t border-gray-200 pt-4">{section('ผู้ดูแลระบบ', admin, <ShieldCheck className="h-3 w-3" aria-hidden />)}</div>
          )}
        </>
      )}
    </nav>
  );
}
