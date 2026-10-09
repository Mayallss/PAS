'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Inbox, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, inputClass, Loading, PageHeader, Progress } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { addDays, currentMonth, hours, mondayOf, shiftMonth, STATUS_STYLE, THAI_WEEKDAY_SHORT, thaiDate, thaiDateShort, thaiMonth, todayBangkok, weekLabel } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import type { DayStatus } from '@/lib/types';
import { CostExplorer } from './_components/cost-explorer';
import { RevenueImport } from './_components/revenue-import';

const TABS = [
  ['completeness', 'ความครบรายสัปดาห์'],
  ['timesheet', 'เวลารายเดือน'],
  ['customers', 'ต้นทุน / กำไร (วิเคราะห์)'],
  ['leave', 'รายการลา'],
  ['revenue', 'รายได้ (นำเข้า)'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function ReportsPage() {
  return (
    <Suspense fallback={<Loading rows={6} />}>
      <Reports />
    </Suspense>
  );
}

function Reports() {
  const me = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // In the URL so a drilled-down view (filters live there too) survives reload, Back and sharing.
  // Importing revenue needs revenue.write: without it the tab is not shown, and a link to it opens the default tab.
  const tabs = TABS.filter(([k]) => k !== 'revenue' || can(me, 'revenue.write'));
  const tab = (tabs.find(([k]) => k === params.get('tab'))?.[0] ?? 'completeness') as Tab;
  return (
    <div className="min-w-0">
      <PageHeader title="รายงาน" description="ข้อมูลตามขอบเขตสิทธิ์ของคุณ — Manager เห็นเฉพาะทีมที่ดูแล" />
      <div role="tablist" aria-label="ประเภทรายงาน" className="mb-5 inline-flex flex-wrap gap-1 rounded-lg bg-white p-1 shadow-card ring-1 ring-gray-300">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => router.push(`${pathname}?tab=${key}`, { scroll: false })}
            className={`h-8 rounded-md px-3 text-[13px] font-medium transition ${tab === key ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}`}
          >
            {key === 'customers' && !can(me, 'cost.read') ? 'ชั่วโมงตามลูกค้า (วิเคราะห์)' : label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-w-0">
        {tab === 'completeness' && <Completeness />}
        {tab === 'timesheet' && <Timesheet />}
        {tab === 'customers' && <CostExplorer />}
        {tab === 'leave' && <Leave />}
        {tab === 'revenue' && <RevenueImport />}
      </div>
    </div>
  );
}

function Nav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button size="icon" onClick={onPrev} aria-label="ก่อนหน้า">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-40 text-center text-sm font-medium">{label}</span>
      <Button size="icon" onClick={onNext} aria-label="ถัดไป">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface CompletenessData {
  weekStart: string;
  weekEnd: string;
  employees: { id: string; fullName: string; requiredMinutes: number; recordedMinutes: number; missingMinutes: number; complete: boolean }[];
}

function Completeness() {
  const [weekOf, setWeekOf] = useState(mondayOf(todayBangkok()));
  const q = useQuery({
    queryKey: ['completeness', weekOf],
    queryFn: () => api<CompletenessData>('/time-report/completeness', { query: { weekOf } }),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const incomplete = d?.employees.filter((e) => !e.complete) ?? [];
  const sorted = d ? [...d.employees].sort((a, b) => b.missingMinutes - a.missingMinutes || a.fullName.localeCompare(b.fullName, 'th')) : [];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="ชั่วโมงที่ขาดรวม"
          value={d ? `${hours(d.employees.reduce((a, e) => a + e.missingMinutes, 0)) || 0} ชม.` : '–'}
          hint="แต่ละคนเทียบกับตารางงานของตนเอง หักวันหยุดบริษัท"
        />
        <StatCard label="กรอกครบแล้ว" value={d ? `${d.employees.length - incomplete.length} / ${d.employees.length} คน` : '–'} progress={d ? [d.employees.length - incomplete.length, d.employees.length] : undefined} />
        <StatCard label="ยังไม่ครบ" value={d ? `${incomplete.length} คน` : '–'} tone={incomplete.length ? 'amber' : 'brand'} />
      </div>
      <Card
        title={d ? `สัปดาห์ ${weekLabel(d.weekStart, d.weekEnd)}` : 'สัปดาห์'}
        actions={<Nav label="" onPrev={() => setWeekOf(addDays(weekOf, -7))} onNext={() => setWeekOf(addDays(weekOf, 7))} />}
        bodyClassName={q.isPlaceholderData ? 'opacity-60' : ''}
      >
        {q.isLoading ? (
          <div className="p-5"><Loading /></div>
        ) : q.error ? (
          <div className="p-5"><Alert tone="error">{errorMessage(q.error)}</Alert></div>
        ) : !sorted.length ? (
          <Empty icon={<Users className="h-5 w-5" />} title="ไม่มีพนักงานในขอบเขตนี้" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {sorted.map((e) => (
              <li key={e.id} className="flex items-center gap-4 px-5 py-3">
                <Link href={`/time-report?date=${d!.weekStart}&employeeId=${e.id}`} className="w-48 shrink-0 truncate text-[13px] font-medium text-gray-900 hover:text-brand-700">
                  {e.fullName}
                </Link>
                <Progress className="flex-1" value={e.recordedMinutes} max={e.requiredMinutes} barClassName={e.complete ? 'bg-brand-500' : 'bg-amber-400'} />
                <span className="w-24 text-right text-[13px] text-gray-900 tabular-nums">
                  {hours(e.recordedMinutes) || 0} / {hours(e.requiredMinutes) || 0}
                </span>
                <span className="w-24 text-right">{e.complete ? <Badge tone="brand">ครบ</Badge> : <Badge tone="amber">ขาด {hours(e.missingMinutes)} ชม.</Badge>}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value, hint, progress, tone }: { label: string; value: string; hint?: string; progress?: [number, number]; tone?: 'amber' | 'brand' }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-card ring-1 ring-gray-200/80">
      <p className="text-[12px] font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${tone === 'amber' ? 'text-amber-600' : tone === 'brand' ? 'text-brand-600' : 'text-gray-900'}`}>{value}</p>
      {hint && <p className="mt-1 text-[12px] text-gray-400">{hint}</p>}
      {progress && <Progress className="mt-3" value={progress[0]} max={progress[1]} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface TimesheetData {
  month: string;
  days: { date: string; weekday: number; weekend: boolean; holiday: string | null }[];
  employees: { id: string; fullName: string; orgUnit: string | null; totalMinutes: number; daily: { date: string; minutes: number; requiredMinutes: number; status: DayStatus }[] }[];
}

function Timesheet() {
  const me = useSession();
  const [month, setMonth] = useState(currentMonth());
  const q = useQuery({ queryKey: ['report-timesheet', month], queryFn: () => api<TimesheetData>('/reports/timesheet', { query: { month } }), placeholderData: keepPreviousData });
  return (
    <Card
      title={`เวลาทำงาน ${thaiMonth(month)}`}
      description="ตัวเลข = ชั่วโมงต่อวัน · สีตามสถานะเทียบชั่วโมงที่ต้องกรอก"
      actions={
        <>
          <Nav label="" onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} />
          {can(me, 'report.export') && (
            <a className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700" href={`/api/reports/timesheet/export?month=${month}`}>
              <Download className="h-4 w-4" /> Excel
            </a>
          )}
        </>
      }
      bodyClassName={q.isPlaceholderData ? 'opacity-60' : ''}
    >
      {q.isLoading ? (
        <div className="p-5"><Loading /></div>
      ) : q.error ? (
        <div className="p-5"><Alert tone="error">{errorMessage(q.error)}</Alert></div>
      ) : !q.data?.employees.length ? (
        <Empty icon={<Inbox className="h-5 w-5" />} title="ไม่มีข้อมูล" />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 min-w-52 border-b border-gray-200 bg-white px-4 py-2 text-left text-[12px] font-medium text-gray-500">
                  พนักงาน
                </th>
                {q.data.days.map((d) => (
                  <th key={d.date} scope="col" title={d.holiday ?? undefined} className={`min-w-9 border-b border-gray-200 px-0.5 py-2 text-center font-normal ${d.weekend || d.holiday ? 'bg-gray-50 text-rose-500' : 'text-gray-500'}`}>
                    <div className="text-[10px]">{THAI_WEEKDAY_SHORT[d.weekday]}</div>
                    <div className="text-[12px] font-semibold text-gray-700">{Number(d.date.slice(8))}</div>
                  </th>
                ))}
                <th scope="col" className="border-b border-gray-200 px-4 text-right text-[12px] font-medium text-gray-500">
                  รวม
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.employees.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50/60">
                  <th scope="row" className="sticky left-0 z-10 border-b border-gray-100 bg-white px-4 py-2 text-left font-normal">
                    <Link className="font-medium text-gray-900 hover:text-brand-700" href={`/time-report?view=month&month=${month}&employeeId=${e.id}`}>
                      {e.fullName}
                    </Link>
                    {e.orgUnit && <div className="text-[11px] text-gray-400">{e.orgUnit}</div>}
                  </th>
                  {e.daily.map((d) => (
                    <td key={d.date} className="border-b border-gray-100 p-0.5 text-center">
                      <span className={`block rounded py-1 tabular-nums ${d.minutes || d.requiredMinutes ? `${STATUS_STYLE[d.status].bg} ${STATUS_STYLE[d.status].text}` : ''}`}>{hours(d.minutes) || (d.requiredMinutes ? '·' : '')}</span>
                    </td>
                  ))}
                  <td className="border-b border-gray-100 px-4 text-right font-semibold tabular-nums">{hours(e.totalMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function useRange() {
  const [from, setFrom] = useState(`${currentMonth()}-01`);
  const [to, setTo] = useState(todayBangkok());
  const inputs = (
    <div className="flex items-center gap-2">
      <input type="date" aria-label="ตั้งแต่" className={`${inputClass} w-40`} value={from} onChange={(e) => setFrom(e.target.value)} />
      <span className="text-gray-400">–</span>
      <input type="date" aria-label="ถึง" className={`${inputClass} w-40`} value={to} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
  return { from, to, inputs, valid: !!from && !!to && from <= to };
}

function Leave() {
  const { from, to, inputs, valid } = useRange();
  const q = useQuery({
    queryKey: ['leave', from, to],
    enabled: valid,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<{ id: string; workDate: string; durationMinutes: number; description: string | null; employee: { fullName: string }; leaveType: string }[]>('/reports/leave', { query: { from, to } }),
  });
  return (
    <Card title="รายการลา" actions={inputs} bodyClassName={q.isPlaceholderData ? 'opacity-60' : ''}>
      {q.isLoading ? (
        <div className="p-5"><Loading /></div>
      ) : q.error ? (
        <div className="p-5"><Alert tone="error">{errorMessage(q.error)}</Alert></div>
      ) : !q.data?.length ? (
        <Empty icon={<Inbox className="h-5 w-5" />} title="ไม่มีรายการลาในช่วงนี้" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {q.data.map((r) => (
            <li key={r.id} className="flex items-center gap-4 px-5 py-3 text-[13px]">
              <span className="w-20 shrink-0 text-gray-500" title={thaiDate(r.workDate)}>
                {thaiDateShort(r.workDate)}
              </span>
              <span className="w-48 shrink-0 truncate font-medium text-gray-900">{r.employee.fullName}</span>
              <Badge tone="amber">{r.leaveType.replace(/^Admin - /, '')}</Badge>
              <span className="flex-1 truncate text-gray-500">{r.description}</span>
              <span className="font-semibold tabular-nums">{hours(r.durationMinutes)} ชม.</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
