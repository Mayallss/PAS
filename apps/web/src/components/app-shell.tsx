'use client';

import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Building2, CalendarCog, Clock3, LogOut, Menu, Search, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { can, useSession } from '@/lib/session';
import type { Permission } from '@/lib/types';
import { CommandPalette } from './command-palette';
import { Kbd } from './ui';

export const NAV: { href: string; label: string; icon: typeof Clock3; perms?: Permission[]; group: 'main' | 'admin' }[] = [
  { href: '/time-report', label: 'บันทึกเวลา', icon: Clock3, group: 'main' },
  { href: '/reports', label: 'รายงาน', icon: BarChart3, perms: ['report.team.read', 'report.all.read'], group: 'main' },
  { href: '/admin/customers', label: 'ลูกค้าและงาน', icon: Building2, perms: ['catalog.write'], group: 'admin' },
  { href: '/admin/calendar', label: 'วันหยุดและนโยบาย', icon: CalendarCog, perms: ['calendar.write'], group: 'admin' },
  { href: '/admin/employees', label: 'พนักงานและสิทธิ์', icon: Users, perms: ['employee.admin'], group: 'admin' },
];

const ROLE_LABEL: Record<string, string> = { MANAGER: 'Manager', PARTNER: 'Partner', ADMIN: 'Admin', IT: 'IT' };

function initials(name: string) {
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('');
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useSession();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const items = NAV.filter((n) => !n.perms || can(me, ...n.perms));
  const roles = me.user.roles.filter((r) => r !== 'EMPLOYEE').map((r) => ROLE_LABEL[r]);

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    window.location.href = '/login';
  }

  const nav = (
    <nav aria-label="เมนูหลัก" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg bg-white px-2.5 text-[13px] text-gray-500 shadow-card ring-1 ring-gray-200 hover:text-gray-700"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1 text-left">ค้นหา / ไปที่…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      {(['main', 'admin'] as const).map((group) => {
        const list = items.filter((i) => i.group === group);
        if (!list.length) return null;
        return (
          <div key={group}>
            {group === 'admin' && <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">ผู้ดูแลระบบ</p>}
            <ul className="space-y-0.5">
              {list.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      prefetch
                      aria-current={active ? 'page' : undefined}
                      className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${
                        active ? 'bg-white font-medium text-gray-900 shadow-card ring-1 ring-gray-200' : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-900'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${active ? 'text-brand-600' : 'text-gray-400'}`} aria-hidden />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const userCard = (
    <div className="flex items-center gap-2.5 border-t border-gray-200 px-3 py-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800" aria-hidden>
        {initials(me.user.fullName)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-gray-900">{me.user.fullName}</p>
        <p className="truncate text-[11px] text-gray-500">{roles.length ? roles.join(' · ') : 'พนักงาน'}</p>
      </div>
      <button type="button" onClick={logout} title="ออกจากระบบ" aria-label="ออกจากระบบ" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-200/60 hover:text-gray-700">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );

  const brand = (
    <Link href="/time-report" className="flex items-center gap-2 px-5 py-4">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-white">
        <Clock3 className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">
        PAS <span className="font-normal text-gray-500">Time</span>
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <a href="#main" className="sr-only z-50 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow-pop">
        ข้ามไปเนื้อหา
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-gray-200 bg-gray-100/70 backdrop-blur lg:flex">
        {brand}
        {nav}
        {userCard}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-gray-200 bg-white/80 px-4 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="เปิดเมนู" className="-ml-1.5 rounded-md p-1.5 text-gray-600 hover:bg-gray-100">
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-[15px] font-semibold">
          PAS <span className="font-normal text-gray-500">Time</span>
        </span>
        <button type="button" onClick={() => setPaletteOpen(true)} aria-label="ค้นหา" className="ml-auto rounded-md p-1.5 text-gray-600 hover:bg-gray-100">
          <Search className="h-5 w-5" />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="เมนู">
          <div className="absolute inset-0 bg-gray-950/30" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-gray-50 shadow-pop">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="ปิดเมนู" className="rounded-md p-1.5 text-gray-500 hover:bg-gray-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {userCard}
          </div>
        </div>
      )}

      <main id="main" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children}
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={items} />
    </div>
  );
}
