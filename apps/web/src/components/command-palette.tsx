'use client';

import { Command } from 'cmdk';
import { CalendarDays, CalendarRange, CornerDownLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { AppLink } from '@/lib/types';
import { AppIcon } from './brand';

/** Ctrl/⌘ + K — jump anywhere without the mouse. */
export function CommandPalette({ open, onOpenChange, apps }: { open: boolean; onOpenChange: (o: boolean) => void; apps: AppLink[] }) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const open_ = (a: AppLink) => {
    if (a.kind === 'EXTERNAL') {
      onOpenChange(false);
      window.open(a.url!, '_blank', 'noopener,noreferrer');
    } else go(a.url!);
  };
  const itemClass =
    'flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-gray-700 data-[selected=true]:bg-gray-100 data-[selected=true]:text-gray-900';

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="ค้นหาคำสั่ง"
      overlayClassName="fixed inset-0 z-50 bg-gray-950/30 backdrop-blur-[2px]"
      contentClassName="fixed top-[15vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl bg-white shadow-pop ring-1 ring-gray-200"
    >
      <Command.Input placeholder="พิมพ์เพื่อค้นหาหน้า หรือคำสั่ง…" className="h-12 w-full border-b border-gray-100 px-4 text-[15px] outline-none placeholder:text-gray-400" />
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-gray-500">ไม่พบผลลัพธ์</Command.Empty>
        <Command.Group heading="บันทึกเวลา" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-gray-400">
          <Command.Item className={itemClass} onSelect={() => go('/')} keywords={['home', 'หน้าหลัก', 'dashboard']}>
            <CalendarRange className="h-4 w-4 text-gray-400" /> หน้าหลัก
          </Command.Item>
          <Command.Item className={itemClass} onSelect={() => go('/time-report')} keywords={['week', 'timesheet', 'สัปดาห์']}>
            <CalendarRange className="h-4 w-4 text-gray-400" /> สัปดาห์นี้
          </Command.Item>
          <Command.Item className={itemClass} onSelect={() => go('/time-report?view=month')} keywords={['month', 'calendar', 'เดือน']}>
            <CalendarDays className="h-4 w-4 text-gray-400" /> ปฏิทินเดือนนี้
          </Command.Item>
        </Command.Group>
        <Command.Group heading="ไปที่หน้า" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-gray-400">
          {apps.map((a) => (
            <Command.Item key={a.key} className={itemClass} onSelect={() => open_(a)} value={`${a.name} ${a.category} ${a.url}`} keywords={[a.description ?? '']}>
              <AppIcon icon={a.icon} className="h-4 w-4 text-gray-400" /> {a.name}
              {a.kind === 'EXTERNAL' && <span className="ml-auto text-[11px] text-gray-400">เปิดแท็บใหม่</span>}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
      <div className="flex items-center gap-1.5 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
        <CornerDownLeft className="h-3 w-3" /> เลือก · Esc ปิด
      </div>
    </Command.Dialog>
  );
}
