'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, CalendarClock, CheckCheck, ChevronRight, ClipboardCheck, Clock3, Megaphone, MessageSquareWarning, Users, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { hours, thaiDate, thaiDateShort } from '@/lib/format';
import type { AttentionItem } from '@/lib/types';

export function attentionText(i: AttentionItem): { icon: typeof Bell; title: string; detail: string; tone: string } {
  switch (i.kind) {
    case 'TIME_MISSING':
      return { icon: Clock3, title: `ยังกรอกเวลาไม่ครบ ${thaiDateShort(i.date)}`, detail: `ขาดอีก ${hours(i.missingMinutes)} ชม.`, tone: 'bg-amber-50 text-amber-600' };
    case 'ACK_REQUIRED':
      return { icon: Megaphone, title: i.title, detail: `ประกาศรอการรับทราบ · ${thaiDate(i.publishedAt.slice(0, 10))}`, tone: 'bg-brand-50 text-brand-600' };
    case 'MEETING_CERTIFY':
      return {
        icon: ClipboardCheck,
        title: i.title,
        detail: i.reason === 'REVISED' ? `ถูกแก้ไขเป็นฉบับที่ ${i.version} — กรุณารับรองใหม่` : i.reason === 'REPLIED' ? 'ผู้บันทึกตอบข้อโต้แย้งของคุณแล้ว' : 'รายงานการประชุมรอการรับรอง',
        tone: i.reason === 'NEW' ? 'bg-brand-50 text-brand-600' : 'bg-amber-50 text-amber-600',
      };
    case 'MEETING_OBJECTIONS':
      return { icon: MessageSquareWarning, title: i.title, detail: `มี ${i.count} ข้อโต้แย้งรอคุณตอบ`, tone: 'bg-rose-50 text-rose-600' };
    case 'TEAM_INCOMPLETE':
      return { icon: Users, title: `ทีม ${i.incomplete}/${i.total} คนยังกรอกไม่ครบ`, detail: `สัปดาห์ที่เริ่ม ${thaiDateShort(i.weekStart)}`, tone: 'bg-rose-50 text-rose-600' };
    case 'IT_REQUESTS':
      return { icon: Wrench, title: `คำขอ IT ใหม่ ${i.count} รายการ`, detail: 'รอรับเรื่อง (แจ้งซ่อม / ขอบริการ)', tone: 'bg-sky-50 text-sky-600' };
    case 'LEAVE_APPROVALS':
      return { icon: CalendarClock, title: `ใบลารออนุมัติ ${i.count} ใบ`, detail: 'ทีมของคุณยื่นขอลา', tone: 'bg-violet-50 text-violet-600' };
    default: {
      // A kind this version of the web does not know yet (API deployed first): show it plainly, never crash the shell.
      const unknown = i as { title?: string };
      return { icon: Bell, title: unknown.title ?? 'มีรายการใหม่', detail: 'เปิดเพื่อดูรายละเอียด', tone: 'bg-gray-100 text-gray-600' };
    }
  }
}

/** Shared notification centre: derived action items, refreshed every minute and on focus. */
export function NotificationBell({ align = 'left' }: { align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ count: number; items: AttentionItem[] }>('/notifications'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const count = q.data?.count ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={count ? `การแจ้งเตือน ${count} รายการ` : 'การแจ้งเตือน'}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-gray-600 transition hover:bg-gray-200/60 hover:text-gray-900"
      >
        <Bell className={`h-[18px] w-[18px] ${count ? 'origin-top animate-wiggle' : ''}`} />
        {count > 0 && (
          <span className="absolute top-1 right-1 grid h-4 min-w-4 animate-ring-pulse place-items-center rounded-full bg-pas-yellow px-1 text-[10px] font-bold text-gray-900">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div
          // Phones: full-width sheet under the header (never clipped). Larger screens: anchored dropdown.
          className={`fixed inset-x-3 top-16 z-50 origin-top animate-pop-in overflow-hidden rounded-xl bg-white shadow-pop ring-1 ring-gray-200 sm:absolute sm:inset-x-auto sm:top-full sm:mt-2 sm:w-[22rem] ${align === 'right' ? 'sm:right-0' : 'sm:left-0'}`}
          role="dialog"
          aria-label="การแจ้งเตือน"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold">การแจ้งเตือน</p>
            {count > 0 && <span className="text-[12px] text-gray-500">{count} รายการที่ต้องทำ</span>}
          </div>
          {count === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCheck className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium">เรียบร้อยทั้งหมด</p>
              <p className="text-[12px] text-gray-500">ไม่มีงานค้างที่ต้องทำตอนนี้</p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
              {q.data!.items.map((i, n) => {
                const t = attentionText(i);
                return (
                  <li key={i.id} className="animate-fade-up stagger" style={{ '--i': n } as React.CSSProperties}>
                    <Link href={i.href} onClick={() => setOpen(false)} className="group flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${t.tone}`}>
                        <t.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-gray-900">{t.title}</span>
                        <span className="block truncate text-[12px] text-gray-500">{t.detail}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-500" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
