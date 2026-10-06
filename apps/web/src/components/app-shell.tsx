'use client';

import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, Menu, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PasLogo } from './brand';
import { CommandPalette } from './command-palette';
import { NotificationBell } from './notification-bell';
import { Optional } from './optional';
import { SidebarNav, useApps } from './sidebar-nav';

// The menu is data (app_link) — see SidebarNav. Admin pages carry is_admin and their own permissions.

const ROLE_LABEL: Record<string, string> = { MANAGER: 'Manager', PARTNER: 'Partner', ADMIN: 'Admin', IT: 'IT', HR: 'HR' };
const roleLabel = (key: string) => ROLE_LABEL[key] ?? key.charAt(0) + key.slice(1).toLowerCase();

function initials(name: string) {
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('');
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useSession();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const apps = useApps();
  const roles = me.user.roles.filter((r) => r !== 'EMPLOYEE').map(roleLabel);

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

  const nav = <SidebarNav pathname={pathname} onOpenPalette={() => setPaletteOpen(true)} />;

  const userCard = (
    <div className="flex items-center gap-2.5 border-t border-gray-200 px-3 py-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800" aria-hidden>
        {initials(me.user.fullName)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-gray-900">{me.user.fullName}</p>
        <p className="truncate text-[11px] text-gray-500">{roles.length ? roles.join(' · ') : 'พนักงาน'}</p>
      </div>
      <Link href="/account" title="บัญชีและรหัสผ่าน" aria-label="บัญชีและรหัสผ่าน" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-200/60 hover:text-gray-700">
        <KeyRound className="h-4 w-4" />
      </Link>
      <button type="button" onClick={logout} title="ออกจากระบบ" aria-label="ออกจากระบบ" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-200/60 hover:text-gray-700">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2.5 px-5 py-4" aria-label="PAS — หน้าหลัก">
      <PasLogo className="h-8 w-auto" priority />
      <span className="border-l border-gray-300 pl-2.5 text-[13px] leading-tight font-medium text-gray-600">
        Employee
        <br />
        Portal
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen lg:pl-60 print:pl-0">
      <a href="#main" className="sr-only z-50 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow-pop">
        ข้ามไปเนื้อหา
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-gray-200 bg-gray-100/70 backdrop-blur lg:flex print:hidden">
        <div className="flex items-center justify-between pr-3">
          {brand}
          <Optional name="bell">
            <NotificationBell />
          </Optional>
        </div>
        {nav}
        {userCard}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-gray-200 bg-white/80 px-4 backdrop-blur lg:hidden print:hidden">
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="เปิดเมนู" className="-ml-1.5 rounded-md p-1.5 text-gray-600 hover:bg-gray-100">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" aria-label="PAS — หน้าหลัก">
          <PasLogo className="h-7 w-auto" />
        </Link>
        <div className="ml-auto">
          <Optional name="bell">
            <NotificationBell align="right" />
          </Optional>
        </div>
        <button type="button" onClick={() => setPaletteOpen(true)} aria-label="ค้นหา" className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100">
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

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} apps={(apps.data ?? []).filter((a) => a.kind !== 'PLANNED' && a.url)} />
    </div>
  );
}
