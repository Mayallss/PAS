'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, currentMonth, mondayOf, shiftMonth, THAI_WEEKDAY_SHORT, thaiMonth, todayBangkok } from '@/lib/format';
import { type CalendarEntry, typeColor } from '@/lib/leave';

/**
 * Who is away, by day. Colleagues see a name and "ลา"; the type is shown only to the person,
 * their team lead and HR (sick leave is health data — PDPA).
 */
export function TeamCalendar() {
  const [month, setMonth] = useState(currentMonth());
  const q = useQuery({ queryKey: ['leave-calendar', month], queryFn: () => api<{ month: string; entries: CalendarEntry[] }>('/leave/calendar', { query: { month } }) });
  const today = todayBangkok();

  const first = `${month}-01`;
  const start = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const weeks = cells.slice(35).every((d) => d.slice(0, 7) !== month) ? 5 : 6;

  const byDate = new Map<string, { entry: CalendarEntry; minutes: number }[]>();
  for (const e of q.data?.entries ?? []) {
    for (const d of e.days) byDate.set(d.date, [...(byDate.get(d.date) ?? []), { entry: e, minutes: d.minutes }]);
  }

  return (
    <Card
      title={thaiMonth(month)}
      description="ใครลาวันไหน (ทีมของคุณ) — เพื่อนร่วมงานเห็นเฉพาะว่าลา ไม่เห็นประเภท"
      actions={
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="เดือนก่อน" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMonth(currentMonth())}>
            เดือนนี้
          </Button>
          <Button size="icon" variant="ghost" aria-label="เดือนถัดไป" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <div className="p-5">
          <Loading rows={5} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[44rem] grid-cols-7 border-t border-gray-100 text-[12px]">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <div key={d} className={`border-b border-gray-100 px-2 py-1.5 text-center font-medium ${d > 5 ? 'text-gray-400' : 'text-gray-500'}`}>
                {THAI_WEEKDAY_SHORT[d]}
              </div>
            ))}
            {cells.slice(0, weeks * 7).map((date, i) => {
              const inMonth = date.slice(0, 7) === month;
              const weekend = i % 7 >= 5;
              const items = byDate.get(date) ?? [];
              return (
                <div key={date} className={`min-h-[5.5rem] border-r border-b border-gray-100 p-1.5 ${inMonth ? (weekend ? 'bg-gray-50/60' : 'bg-white') : 'bg-gray-50/30 text-gray-300'}`}>
                  <div className={`mb-1 text-right text-[11px] ${date === today ? 'font-semibold text-brand-600' : inMonth ? 'text-gray-500' : ''}`}>
                    {date === today ? <span className="rounded-full bg-brand-600 px-1.5 py-px text-white">{Number(date.slice(8))}</span> : Number(date.slice(8))}
                  </div>
                  <div className="space-y-0.5">
                    {items.slice(0, 4).map(({ entry, minutes }) => {
                      const c = typeColor(entry.type?.color ?? 'gray');
                      return (
                        <div
                          key={entry.id}
                          title={`${entry.employee.name} · ${entry.type?.name ?? 'ลา'}${minutes < 540 ? ` ${minutes / 60} ชม.` : ''}${entry.status === 'PENDING' ? ' (รออนุมัติ)' : ''}`}
                          className={`flex items-center gap-1 truncate rounded px-1 py-0.5 ring-1 ring-inset ${c.soft} ${entry.status === 'PENDING' ? 'border border-dashed border-gray-300 opacity-75' : ''}`}
                        >
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />
                          <span className="truncate text-gray-800">{entry.employee.name.split(' (')[0]}</span>
                          {minutes < 540 && <span className="shrink-0 text-gray-500">{minutes / 60}ชม.</span>}
                        </div>
                      );
                    })}
                    {items.length > 4 && <div className="px-1 text-gray-400">+{items.length - 4}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="flex items-center gap-1.5 px-4 py-2.5 text-[12px] text-gray-400">
            <EyeOff className="h-3.5 w-3.5" /> กรอบเส้นประ = รออนุมัติ · สีเทา = ไม่แสดงประเภทการลา
          </p>
        </div>
      )}
    </Card>
  );
}
