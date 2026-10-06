'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardCheck, Clock, MapPin, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, Loading, PageHeader, Progress } from '@/components/ui';
import { api } from '@/lib/api';
import { thaiDate } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import type { MeetingListItem } from '@/lib/types';
import { StatusPill } from './_components/status';

const NEEDS_ACTION = new Set(['PENDING', 'OUTDATED', 'OBJECTION_REPLIED']);

export default function MeetingsPage() {
  const me = useSession();
  const writer = can(me, 'meeting.write');
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');
  const q = useQuery({ queryKey: ['meetings'], queryFn: () => api<MeetingListItem[]>('/meetings') });
  const todo = (q.data ?? []).filter((m) => m.myStatus && NEEDS_ACTION.has(m.myStatus));
  const list = filter === 'todo' && todo.length ? todo : (q.data ?? []);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="รายงานการประชุม"
        description="อ่านแล้วรับรองว่าถูกต้อง หรือเลือกข้อความที่ไม่ถูกต้องเพื่อแย้ง — เมื่อรายงานถูกแก้ ส่วนที่เปลี่ยนจะไฮไลต์ให้เห็น"
        actions={
          writer && (
            <Link href="/meetings/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
              <Plus className="h-4 w-4" /> บันทึกรายงาน
            </Link>
          )
        }
      />
      <div role="tablist" className="mb-4 inline-flex rounded-lg bg-gray-100 p-1">
        {[
          ['todo', `รอฉันดำเนินการ${todo.length ? ` (${todo.length})` : ''}`],
          ['all', 'ทั้งหมด'],
        ].map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={filter === k}
            onClick={() => setFilter(k as 'todo' | 'all')}
            className={`h-8 rounded-md px-3 text-[13px] font-medium ${filter === k ? 'bg-white shadow-card' : 'text-gray-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {filter === 'todo' && q.data && !todo.length && (
        <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">ไม่มีรายงานที่รอคุณรับรอง — แสดงทั้งหมดด้านล่าง</p>
      )}
      {q.isLoading ? (
        <Loading rows={5} />
      ) : !list.length ? (
        <Empty icon={<ClipboardCheck className="h-5 w-5" />} title="ยังไม่มีรายงานการประชุม" />
      ) : (
        <ul className="space-y-3">
          {list.map((m, i) => (
            <li key={m.id} className="animate-fade-up stagger" style={{ '--i': Math.min(i, 8) } as React.CSSProperties}>
              <Link href={`/meetings/${m.id}`} className="group block rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-200/80 transition hover:-translate-y-0.5 hover:shadow-pop hover:ring-brand-200">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-gray-900 group-hover:text-brand-700">{m.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {thaiDate(m.meetingDate)}</span>
                      {m.startTime && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {m.startTime}{m.endTime ? `–${m.endTime}` : ''}</span>}
                      {m.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {m.location}</span>}
                      <span>บันทึกโดย {m.author}</span>
                      {m.version > 1 && <Badge tone="sky">ฉบับที่ {m.version}</Badge>}
                    </p>
                  </div>
                  {m.myStatus ? <StatusPill status={m.myStatus} /> : <Badge>{m.isAuthor ? 'คุณเป็นผู้บันทึก' : 'ไม่ต้องรับรอง'}</Badge>}
                </div>
                {m.counts && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-gray-500">
                    <Progress className="min-w-40 flex-1" value={m.counts.accepted} max={m.counts.audience} />
                    <span>รับรอง {m.counts.accepted}/{m.counts.audience}</span>
                    {m.counts.objections > 0 && <Badge tone="rose">แย้ง {m.counts.objections}</Badge>}
                    {m.counts.pending > 0 && <Badge tone="amber">รอ {m.counts.pending}</Badge>}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
