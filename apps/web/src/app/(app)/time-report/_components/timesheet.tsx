'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, CloudUpload, Eye, Lock } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Progress } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, hours, mondayOf, shiftMonth, STATUS_STYLE, thaiMonth, todayBangkok, weekLabel } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import type { MonthSummary, Task, WeekRow, WeekView } from '@/lib/types';
import { SaveInput, useCellSaver, useMonth, useSyncStatus, useWeek, weekKey } from '../_lib/timesheet-data';
import { focusCell } from './cell-input';
import { DayList } from './day-list';
import { FillFromPlan } from './fill-from-plan';
import { Inspector } from './inspector';
import { MonthCalendar } from './month-calendar';
import { CellRef, WeekGrid } from './week-grid';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

type Nav = { view?: 'week' | 'month'; date?: string; month?: string; employeeId?: string | null };

/** URL is the source of truth, updated with pushState → no server round trip, back/forward still work. */
function useTimesheetParams(today: string) {
  const params = useSearchParams();
  const view = params.get('view') === 'month' ? 'month' : 'week';
  const date = ISO_DATE.test(params.get('date') ?? '') ? params.get('date')! : today;
  const month = ISO_MONTH.test(params.get('month') ?? '') ? params.get('month')! : date.slice(0, 7);
  const employeeId = params.get('employeeId') ?? undefined;
  const navigate = useCallback(
    (next: Nav) => {
      const q = new URLSearchParams();
      const v = next.view ?? view;
      if (v === 'month') {
        q.set('view', 'month');
        q.set('month', next.month ?? month);
      } else {
        const d = next.date ?? date;
        if (d !== today) q.set('date', d);
      }
      const emp = next.employeeId === undefined ? employeeId : next.employeeId;
      if (emp) q.set('employeeId', emp);
      const s = q.toString();
      window.history.pushState(null, '', s ? `?${s}` : window.location.pathname);
    },
    [view, date, month, employeeId, today],
  );
  return { view, date, month, employeeId, navigate };
}

export function Timesheet({ initialWeek, initialMonth }: { initialWeek?: WeekView; initialMonth?: MonthSummary }) {
  const today = initialWeek?.today ?? initialMonth?.today ?? todayBangkok();
  const p = useTimesheetParams(today);
  return p.view === 'month' ? <MonthPanel {...p} today={today} initial={initialMonth} /> : <WeekPanel {...p} today={today} initial={initialWeek} />;
}

// ---------------------------------------------------------------------------

export function Header({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">{subtitle}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: 'week' | 'month'; onChange: (v: 'week' | 'month') => void }) {
  const opt = (v: 'week' | 'month', label: string, Icon: typeof CalendarRange) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === v}
      onClick={() => onChange(v)}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition ${view === v ? 'bg-white text-gray-900 shadow-card' : 'text-gray-500 hover:text-gray-900'}`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="มุมมอง" className="flex rounded-lg bg-gray-100 p-1">
      {opt('week', 'สัปดาห์', CalendarRange)}
      {opt('month', 'เดือน', CalendarDays)}
    </div>
  );
}

export function Stepper({ label, onPrev, onNext, onToday, isCurrent }: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void; isCurrent: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="secondary" size="icon" onClick={onPrev} aria-label="ก่อนหน้า">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[10.5rem] text-center text-sm font-medium text-gray-900 tabular-nums" aria-live="polite">
        {label}
      </span>
      <Button variant="secondary" size="icon" onClick={onNext} aria-label="ถัดไป">
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={onToday} disabled={isCurrent}>
        วันนี้
      </Button>
    </div>
  );
}

export function EmployeePicker({ value, onChange }: { value: string | undefined; onChange: (id: string | null) => void }) {
  const me = useSession();
  const enabled = can(me, 'report.team.read', 'report.all.read');
  const q = useQuery({ queryKey: ['employees'], queryFn: () => api<{ id: string; fullName: string }[]>('/employees'), enabled, staleTime: 5 * 60_000 });
  if (!enabled) return null;
  return (
    <select
      aria-label="ดูเวลาของพนักงาน"
      className="h-9 max-w-52 rounded-lg border-0 bg-white px-3 text-sm shadow-card ring-1 ring-gray-200 ring-inset focus:ring-2 focus:ring-brand-600"
      value={value ?? me.user.id}
      onChange={(e) => onChange(e.target.value === me.user.id ? null : e.target.value)}
    >
      {!q.data && <option value={value ?? me.user.id}>{value ? 'กำลังโหลด…' : me.user.fullName}</option>}
      {q.data?.map((e) => (
        <option key={e.id} value={e.id}>
          {e.id === me.user.id ? `${e.fullName} (ฉัน)` : e.fullName}
        </option>
      ))}
    </select>
  );
}

function SyncIndicator() {
  const { pending, lastSavedAt } = useSyncStatus();
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
  return (
    <span className="flex h-9 items-center gap-1.5 px-1 text-[12px] text-gray-500" aria-live="polite">
      {pending ? (
        <>
          <CloudUpload className="h-3.5 w-3.5 animate-pulse text-brand-600" /> กำลังบันทึก…
        </>
      ) : lastSavedAt ? (
        <>
          <Check className="h-3.5 w-3.5 text-brand-600" /> บันทึกแล้ว{' '}
          {new Date(lastSavedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5" /> บันทึกอัตโนมัติ
        </>
      )}
    </span>
  );
}

export function Stat({ label, children, footer, className = '' }: { label: string; children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl bg-white p-3.5 shadow-card ring-1 ring-gray-200/80 sm:p-4 ${className}`}>
      <p className="truncate text-[12px] font-medium text-gray-500">{label}</p>
      <div className="mt-1 text-xl font-semibold tracking-tight text-gray-900 tabular-nums sm:text-2xl">{children}</div>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PanelProps extends ReturnType<typeof useTimesheetParams> {
  today: string;
}

function WeekPanel({ date, employeeId, navigate, today, initial }: PanelProps & { initial?: WeekView }) {
  const me = useSession();
  const key = useMemo(() => weekKey(employeeId, date), [employeeId, date]);
  const q = useWeek(date, employeeId, initial);
  const save = useCellSaver(key);
  const weekStart = mondayOf(date);

  const [added, setAdded] = useState<Record<string, Task[]>>({});
  const [hidden, setHidden] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [mobileDay, setMobileDay] = useState<string | null>(null);
  useEffect(() => setSelected(null), [weekStart, employeeId]);

  const view = q.data;
  const rows = useMemo<WeekRow[]>(() => {
    if (!view) return [];
    const hide = new Set(hidden[weekStart] ?? []);
    const base = view.rows.filter((r) => !hide.has(r.engagementId) || r.totalMinutes > 0);
    const ids = new Set(base.map((r) => r.engagementId));
    const extra = (added[weekStart] ?? []).filter((t) => !ids.has(t.engagementId)).map((t) => ({ ...t, cells: {}, totalMinutes: 0, carried: false }));
    return [...base, ...extra];
  }, [view, added, hidden, weekStart]);

  const commit = useCallback((task: Task, d: string, minutes: number | null) => save({ task, date: d, minutes }), [save]);
  const onSave = useCallback((input: SaveInput) => save(input), [save]);

  if (!view) return null; // server-rendered initial data means this is effectively never hit
  const own = view.employee.id === me.user.id;
  const todayInWeek = view.days.find((d) => d.date === today);
  const dueDays = view.days.filter((d) => d.requiredMinutes > 0 && d.date <= today);
  const completeDays = dueDays.filter((d) => d.totalMinutes >= d.requiredMinutes).length;
  const lockedAll = view.days.every((d) => d.locked);

  function addTask(task: Task) {
    setAdded((a) => ({ ...a, [weekStart]: [...(a[weekStart] ?? []), task] }));
    const col = Math.max(0, view!.days.findIndex((d) => d.date === today));
    requestAnimationFrame(() => focusCell('week', rows.length, col));
  }

  return (
    <div>
      <Header
        title="บันทึกเวลา"
        subtitle={
          own ? (
            view.employee.fullName
          ) : (
            <>
              <Eye className="h-4 w-4" /> กำลังดูของ {view.employee.fullName} <Badge>อ่านอย่างเดียว</Badge>
            </>
          )
        }
      >
        {own && <SyncIndicator />}
        {own && view.editable && <FillFromPlan date={weekStart} today={today} />}
        <EmployeePicker value={employeeId} onChange={(id) => navigate({ employeeId: id })} />
        <ViewToggle view="week" onChange={(v) => navigate({ view: v, month: date.slice(0, 7) })} />
        <Stepper
          label={weekLabel(view.weekStart, view.weekEnd)}
          onPrev={() => navigate({ date: addDays(weekStart, -7) })}
          onNext={() => navigate({ date: addDays(weekStart, 7) })}
          onToday={() => navigate({ date: today })}
          isCurrent={!!todayInWeek}
        />
      </Header>

      {lockedAll && (
        <div className="mb-4">
          <Alert tone="warning">
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> งวดนี้ถูกปิดแล้ว — ดูได้อย่างเดียว
            </span>
          </Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat
          label="ชั่วโมงสัปดาห์นี้"
          footer={<Progress value={view.totals.recordedMinutes} max={view.totals.requiredMinutes} barClassName={view.totals.recordedMinutes > view.totals.requiredMinutes ? 'bg-rose-500' : 'bg-brand-500'} />}
        >
          {hours(view.totals.recordedMinutes) || '0'} <span className="text-base font-normal text-gray-400">/ {hours(view.totals.requiredMinutes) || 0} ชม.</span>
        </Stat>
        <Stat
          label="วันที่กรอกครบ (ถึงวันนี้)"
          footer={
            <div className="flex gap-1.5">
              {view.days.map((d) => (
                <span
                  key={d.date}
                  title={`${d.date}: ${STATUS_STYLE[d.status].label}`}
                  className={`h-1.5 flex-1 rounded-full ${d.requiredMinutes === 0 && !d.totalMinutes ? 'bg-gray-100' : d.date > today && !d.totalMinutes ? 'bg-gray-200' : STATUS_STYLE[d.status].bar}`}
                />
              ))}
            </div>
          }
        >
          {completeDays} <span className="text-base font-normal text-gray-400">/ {dueDays.length} วัน</span>
        </Stat>
        <Stat label={todayInWeek ? 'วันนี้' : 'ตารางงาน'} className="hidden sm:block" footer={view.scheduleName ? <p className="truncate text-[12px] text-gray-500">{view.scheduleName}</p> : undefined}>
          {todayInWeek ? (
            <span className={STATUS_STYLE[todayInWeek.status].text}>
              {hours(todayInWeek.totalMinutes) || '0'} <span className="text-base font-normal text-gray-400">/ {hours(todayInWeek.requiredMinutes) || 0} ชม.</span>
            </span>
          ) : (
            <>
              {hours(view.totals.requiredMinutes) || 0} <span className="text-base font-normal text-gray-400">ชม./สัปดาห์</span>
            </>
          )}
        </Stat>
      </div>

      <div className={`grid gap-4 2xl:grid-cols-[minmax(0,1fr)_20rem] ${q.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}`} aria-busy={q.isPlaceholderData}>
        <section className="overflow-visible rounded-xl bg-white shadow-card ring-1 ring-gray-200/80">
          <div className="hidden md:block">
            <WeekGrid
              view={view}
              rows={rows}
              selected={selected}
              onSelect={setSelected}
              onCommit={commit}
              onAddTask={addTask}
              onHideRow={(id) => setHidden((h) => ({ ...h, [weekStart]: [...(h[weekStart] ?? []), id] }))}
            />
          </div>
          <div className="md:hidden">
            <DayList
              view={view}
              rows={rows}
              day={mobileDay && view.days.some((d) => d.date === mobileDay) ? mobileDay : (todayInWeek?.date ?? view.weekStart)}
              onDay={setMobileDay}
              onCommit={commit}
              onAddTask={(t) => setAdded((a) => ({ ...a, [weekStart]: [...(a[weekStart] ?? []), t] }))}
            />
          </div>
        </section>
        <aside className="hidden self-start rounded-xl bg-white shadow-card ring-1 ring-gray-200/80 md:block 2xl:sticky 2xl:top-8">
          <Inspector view={view} rows={rows} selected={selected} onSave={onSave} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MonthPanel({ month, employeeId, navigate, today, initial }: PanelProps & { initial?: MonthSummary }) {
  const q = useMonth(month, employeeId, initial);
  const data = q.data;
  if (!data) return null;
  const t = data.totals;
  return (
    <div>
      <Header title="บันทึกเวลา" subtitle="ภาพรวมรายเดือน — คลิกวันที่เพื่อกรอกเวลาในสัปดาห์นั้น">
        <EmployeePicker value={employeeId} onChange={(id) => navigate({ employeeId: id })} />
        <ViewToggle view="month" onChange={(v) => navigate({ view: v, date: month === today.slice(0, 7) ? today : `${month}-01` })} />
        <Stepper
          label={thaiMonth(month)}
          onPrev={() => navigate({ month: shiftMonth(month, -1) })}
          onNext={() => navigate({ month: shiftMonth(month, 1) })}
          onToday={() => navigate({ month: today.slice(0, 7) })}
          isCurrent={month === today.slice(0, 7)}
        />
      </Header>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat label="ชั่วโมงทั้งเดือน" footer={<Progress value={t.recordedMinutes} max={t.requiredMinutes} />}>
          {hours(t.recordedMinutes) || '0'} <span className="text-base font-normal text-gray-400">/ {hours(t.requiredMinutes) || 0} ชม.</span>
        </Stat>
        <Stat label="วันทำงานที่กรอกครบ (ถึงวันนี้)" footer={<Progress value={t.completeDueDays} max={t.dueDays} />}>
          {t.completeDueDays} <span className="text-base font-normal text-gray-400">/ {t.dueDays} วัน</span>
        </Stat>
        <Stat label="ยังต้องเติม" className="hidden sm:block">
          {t.dueDays - t.completeDueDays > 0 ? (
            <span className="text-amber-600">
              {t.dueDays - t.completeDueDays} <span className="text-base font-normal text-gray-400">วัน</span>
            </span>
          ) : (
            <span className="text-brand-600">ครบแล้ว</span>
          )}
        </Stat>
      </div>
      {data.locked && (
        <div className="mb-4">
          <Alert tone="warning">งวด {thaiMonth(month)} ถูกปิดแล้ว</Alert>
        </div>
      )}
      <section className={`rounded-xl bg-white shadow-card ring-1 ring-gray-200/80 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
        <MonthCalendar data={data} onPickDay={(d) => navigate({ view: 'week', date: d })} />
      </section>
    </div>
  );
}
