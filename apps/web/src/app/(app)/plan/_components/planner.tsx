'use client';

import { CalendarRange, Eye, ListTodo, Undo2, UsersRound } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Badge, Button, Progress } from '@/components/ui';
import { addDays, mondayOf, THAI_WEEKDAY_SHORT, thaiDateShort, todayBangkok, weekLabel } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import type { PlanDay, PlanWeek, Task, TodoItem } from '@/lib/types';
import { AddTask } from '../../time-report/_components/add-task';
import { EmployeePicker, Header, Stat, Stepper } from '../../time-report/_components/timesheet';
import { planKey, usePlanMutations, usePlanWeek } from '../_lib/plan-data';
import { EditItem } from './edit-item';
import { PlanCard } from './plan-card';
import { baht, hrs, isLate, isOpen, sortItems } from './plan-style';
import { TeamBoard } from './team-board';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** New task default: one hour — the step buttons adjust it in one click. */
const DEFAULT_MINUTES = 60;

type Nav = { view?: 'board' | 'team'; date?: string; employeeId?: string | null };

function usePlanParams(today: string) {
  const params = useSearchParams();
  const view = params.get('view') === 'team' ? 'team' : 'board';
  const date = ISO_DATE.test(params.get('date') ?? '') ? params.get('date')! : today;
  const employeeId = params.get('employeeId') ?? undefined;
  const navigate = useCallback(
    (next: Nav) => {
      const q = new URLSearchParams();
      if ((next.view ?? view) === 'team') q.set('view', 'team');
      const d = next.date ?? date;
      if (mondayOf(d) !== mondayOf(today)) q.set('date', d);
      const emp = next.employeeId === undefined ? employeeId : next.employeeId;
      if (emp && (next.view ?? view) === 'board') q.set('employeeId', emp);
      const s = q.toString();
      window.history.pushState(null, '', s ? `?${s}` : window.location.pathname);
    },
    [view, date, employeeId, today],
  );
  return { view, date, employeeId, navigate };
}

export function Planner({ initial }: { initial?: PlanWeek }) {
  const me = useSession();
  const today = initial?.today ?? todayBangkok();
  const p = usePlanParams(today);
  const canSeeTeam = can(me, 'report.team.read', 'report.all.read');

  const toggle = canSeeTeam && (
    <div role="radiogroup" aria-label="มุมมอง" className="flex rounded-lg bg-gray-100 p-1">
      {(
        [
          ['board', 'แผนรายคน', CalendarRange],
          ['team', 'ภาพรวมทีม', UsersRound],
        ] as const
      ).map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={p.view === v}
          onClick={() => p.navigate({ view: v })}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition ${p.view === v ? 'bg-white text-gray-900 shadow-card' : 'text-gray-500 hover:text-gray-900'}`}
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );

  if (p.view === 'team' && canSeeTeam) {
    return <TeamBoard date={p.date} today={today} toggle={toggle} navigate={p.navigate} />;
  }
  return <Board {...p} today={today} initial={initial} toggle={toggle} />;
}

// ---------------------------------------------------------------------------

function Board({ date, employeeId, navigate, today, initial, toggle }: ReturnType<typeof usePlanParams> & { today: string; initial?: PlanWeek; toggle: React.ReactNode }) {
  const q = usePlanWeek(date, employeeId, initial);
  const key = useMemo(() => planKey(employeeId, date), [employeeId, date]);
  const { create, update, remove, carryOver } = usePlanMutations(key, employeeId);
  const [openItem, setOpenItem] = useState<TodoItem | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [mobileDay, setMobileDay] = useState<string | null>(null);

  const week = q.data;
  const byDay = useMemo(() => {
    const m = new Map<string, TodoItem[]>();
    for (const i of week?.items ?? []) m.set(i.workDate, [...(m.get(i.workDate) ?? []), i]);
    for (const [d, list] of m) m.set(d, sortItems(list));
    return m;
  }, [week?.items]);

  const onToggleDone = useCallback((item: TodoItem) => update.mutate({ item, patch: { status: item.status === 'DONE' ? 'PLANNED' : 'DONE' } }), [update]);
  // Custom items may drop to "no time" (null); task items always keep an estimate.
  const onMinutes = useCallback((item: TodoItem, minutes: number) => update.mutate({ item, patch: { plannedMinutes: minutes > 0 ? minutes : null } }), [update]);
  const onOpen = useCallback((item: TodoItem) => setOpenItem(item), []);

  if (!week) return null;
  const { policy, canEdit, own } = week;
  // Estimates count task items only; custom items are personal notes.
  const plannedOf = (d: string) => (byDay.get(d) ?? []).filter((i) => i.kind === 'TASK' && i.status !== 'CANCELLED').reduce((a, i) => a + (i.plannedMinutes ?? 0), 0);
  const planned = week.days.reduce((a, d) => a + plannedOf(d.date), 0);
  const required = week.days.reduce((a, d) => a + d.requiredMinutes, 0);
  const actual = week.days.reduce((a, d) => a + d.actualMinutes, 0);
  const counted = week.items.filter((i) => i.kind === 'TASK' && i.status !== 'CANCELLED');
  const doneCount = counted.filter((i) => i.status === 'DONE').length;
  const lateInWeek = week.items.filter((i) => isLate(i, today)).length;
  const totalLate = lateInWeek + week.overdue;
  const activeDay = mobileDay && week.days.some((d) => d.date === mobileDay) ? mobileDay : (week.days.find((d) => d.date === today)?.date ?? week.days[0].date);

  const add = (day: PlanDay) => (task: Task) => create.mutate({ task, workDate: day.date, plannedMinutes: Math.min(DEFAULT_MINUTES, policy.maxEntryMinutes) });
  const addCustom = (day: PlanDay) => (title: string) => create.mutate({ title, workDate: day.date, plannedMinutes: null });
  const drop = (day: PlanDay) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain');
    const item = week.items.find((i) => i.id === id);
    if (item && item.workDate !== day.date) update.mutate({ item, patch: { workDate: day.date } });
  };

  const column = (day: PlanDay, mobile = false) => {
    const items = byDay.get(day.date) ?? [];
    const plannedMin = plannedOf(day.date);
    const isToday = day.date === today;
    const editable = canEdit && !day.locked;
    const tone = day.requiredMinutes === 0 ? 'bg-gray-300' : plannedMin > day.requiredMinutes ? 'bg-rose-400' : plannedMin >= day.requiredMinutes ? 'bg-emerald-500' : 'bg-amber-400';
    return (
      <section
        key={day.date}
        aria-label={`${THAI_WEEKDAY_SHORT[day.weekday]} ${thaiDateShort(day.date)}`}
        onDragOver={editable ? (e) => (e.preventDefault(), setDragOver(day.date)) : undefined}
        onDragLeave={() => setDragOver((d) => (d === day.date ? null : d))}
        onDrop={editable ? drop(day) : undefined}
        className={`flex min-w-0 flex-col rounded-xl p-2 transition ${mobile ? '' : 'min-h-72'} ${
          dragOver === day.date ? 'bg-brand-50 ring-2 ring-brand-300' : isToday ? 'bg-brand-50/50 ring-1 ring-brand-200' : day.weekend || day.holiday ? 'bg-gray-50' : 'bg-gray-100/60'
        }`}
      >
        {!mobile && (
          <header className="mb-2 px-1">
            <div className="flex items-baseline justify-between">
              <p className={`text-[13px] font-semibold ${isToday ? 'text-brand-700' : 'text-gray-800'}`}>
                {THAI_WEEKDAY_SHORT[day.weekday]} {Number(day.date.slice(8))}
                {isToday && <span className="ml-1.5 rounded bg-brand-600 px-1.5 py-px text-[10.5px] font-medium text-white">วันนี้</span>}
              </p>
              <p className="text-[11.5px] text-gray-500 tabular-nums" title="วางแผน / ชั่วโมงที่ต้องทำ">
                {hrs(plannedMin).replace(' ชม.', '')}/{hrs(day.requiredMinutes)}
              </p>
            </div>
            <Progress value={plannedMin} max={Math.max(day.requiredMinutes, plannedMin, 1)} className="mt-1.5 h-1" barClassName={tone} />
            {day.holiday && <p className="mt-1 truncate text-[11px] text-amber-700">{day.holiday.description}</p>}
            {day.actualMinutes > 0 && <p className="mt-1 text-[11px] text-gray-500 tabular-nums">ลงเวลาจริง {hrs(day.actualMinutes)}</p>}
          </header>
        )}
        <div className="flex flex-1 flex-col gap-1.5">
          {items.map((item) => (
            <PlanCard key={item.id} item={item} today={today} step={policy.incrementMinutes} max={policy.maxEntryMinutes} editable={editable} onToggleDone={onToggleDone} onMinutes={onMinutes} onOpen={onOpen} />
          ))}
          {items.length === 0 && !editable && <p className="px-1 py-3 text-center text-[12px] text-gray-400">ไม่มีแผนงาน</p>}
        </div>
        {editable && (
          <div className="mt-1.5">
            <AddTask
              recent={week.recentTasks}
              exclude={new Set(items.filter((i) => i.task && i.status !== 'CANCELLED').map((i) => i.task!.engagementId))}
              onAdd={add(day)}
              onCreateCustom={addCustom(day)}
              label="เพิ่มงาน"
              className="flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-gray-500 hover:bg-white hover:text-brand-700"
            />
          </div>
        )}
      </section>
    );
  };

  return (
    <div>
      <Header
        title="แผนงาน"
        subtitle={
          own ? (
            <>
              <ListTodo className="h-4 w-4" /> วางแผนงาน = ประมาณการเวลา · เวลาจริงมาจากหน้าบันทึกเวลา
            </>
          ) : canEdit ? (
            <>
              <UsersRound className="h-4 w-4" /> กำลังวางแผนให้ {week.employee.fullName}
            </>
          ) : (
            <>
              <Eye className="h-4 w-4" /> แผนของ {week.employee.fullName} <Badge>อ่านอย่างเดียว</Badge>
            </>
          )
        }
      >
        {toggle}
        <EmployeePicker value={employeeId} onChange={(id) => navigate({ employeeId: id })} />
        <Stepper
          label={weekLabel(week.weekStart, week.weekEnd)}
          onPrev={() => navigate({ date: addDays(week.weekStart, -7) })}
          onNext={() => navigate({ date: addDays(week.weekStart, 7) })}
          onToday={() => navigate({ date: today })}
          isCurrent={week.days.some((d) => d.date === today)}
        />
      </Header>

      <div className={`mb-4 grid grid-cols-2 gap-3 ${week.cost ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <Stat
          label="วางแผนสัปดาห์นี้"
          footer={<Progress value={planned} max={Math.max(required, planned, 1)} barClassName={planned > required ? 'bg-rose-400' : planned >= required ? 'bg-emerald-500' : 'bg-amber-400'} />}
        >
          {hrs(planned)} <span className="text-sm font-normal text-gray-500">/ {hrs(required)}</span>
        </Stat>
        <Stat label="ลงเวลาจริงแล้ว" footer={<Progress value={actual} max={Math.max(required, actual, 1)} barClassName="bg-sky-500" />}>
          {hrs(actual)} <span className="text-sm font-normal text-gray-500">/ {hrs(required)}</span>
        </Stat>
        <Stat label="งานที่เสร็จ" footer={<Progress value={doneCount} max={Math.max(counted.length, 1)} barClassName="bg-emerald-500" />}>
          {doneCount} <span className="text-sm font-normal text-gray-500">/ {counted.length} งาน</span>
        </Stat>
        {week.cost && (
          <Stat
            label="ต้นทุนประมาณการ / จริง"
            className="col-span-2 lg:col-span-1"
            footer={
              <p className="text-[12px] text-gray-500">
                {week.cost.unpricedMinutes ? `${hrs(week.cost.unpricedMinutes)} ยังไม่มีอัตราต้นทุน` : 'อัตราตามระดับพนักงาน ณ วันที่ทำงาน'}
              </p>
            }
          >
            {baht(week.cost.planned)} <span className="text-sm font-normal text-gray-500">/ {baht(week.cost.actual)}</span>
          </Stat>
        )}
      </div>

      {canEdit && totalLate > 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>
                มีงานที่ยังไม่เสร็จและเลยกำหนด {totalLate} รายการ{week.overdue ? ` (รวม ${week.overdue} รายการจากสัปดาห์ก่อน)` : ''}
              </span>
              <Button size="sm" variant="secondary" loading={carryOver.isPending} onClick={() => carryOver.mutate(today)}>
                <Undo2 className="h-3.5 w-3.5" /> ย้ายงานค้างมาวันนี้
              </Button>
            </span>
          </Alert>
        </div>
      )}

      {canEdit && week.items.length === 0 && (
        <p className="mb-3 rounded-lg bg-brand-50/60 px-3 py-2 text-[13px] text-brand-800">
          เริ่มวางแผน: กด <b>+ เพิ่มงาน</b> ในวันที่จะทำ เลือกลูกค้า/Activity แล้วปรับชั่วโมงด้วยปุ่ม − + · หรือพิมพ์อะไรก็ได้แล้วเลือก “เพิ่มเป็นงานอื่น” (จดไว้เฉยๆ ไม่นับในประมาณการ) · ลากการ์ดไปวันอื่นเพื่อเลื่อนงาน · ติ๊กวงกลมเมื่อเสร็จ
        </p>
      )}

      {/* Desktop: the whole week, drag cards between days. Empty days off-schedule (weekends) get narrow columns. */}
      <div className="hidden gap-2 lg:grid" style={{ gridTemplateColumns: week.days.map((d) => (d.requiredMinutes === 0 && !(byDay.get(d.date)?.length) ? 'minmax(0,0.55fr)' : 'minmax(0,1fr)')).join(' ') }}>
        {week.days.map((d) => column(d))}
      </div>

      {/* Mobile: one day at a time */}
      <div className="lg:hidden">
        <div className="mb-3 grid grid-cols-7 gap-1" role="tablist" aria-label="เลือกวัน">
          {week.days.map((d) => {
            const pm = plannedOf(d.date);
            const openItems = (byDay.get(d.date) ?? []).filter(isOpen).length;
            return (
              <button
                key={d.date}
                type="button"
                role="tab"
                aria-selected={activeDay === d.date}
                onClick={() => setMobileDay(d.date)}
                className={`rounded-lg py-1.5 text-center transition ${activeDay === d.date ? 'bg-gray-900 text-white' : d.date === today ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <span className="block text-[11px]">{THAI_WEEKDAY_SHORT[d.weekday]}</span>
                <span className="block text-[15px] font-semibold tabular-nums">{Number(d.date.slice(8))}</span>
                <span className={`mx-auto mt-0.5 block h-1 w-5 rounded-full ${pm === 0 ? 'bg-transparent' : pm >= d.requiredMinutes ? 'bg-emerald-500' : 'bg-amber-400'}`} aria-label={`${openItems} งานค้าง`} />
              </button>
            );
          })}
        </div>
        {week.days.filter((d) => d.date === activeDay).map((d) => (
          <div key={d.date}>
            <p className="mb-2 flex items-baseline justify-between px-1 text-[13px]">
              <span className="font-semibold text-gray-800">{thaiDateShort(d.date)}</span>
              <span className="text-gray-500 tabular-nums">
                วางแผน {hrs(plannedOf(d.date))} / {hrs(d.requiredMinutes)}
              </span>
            </p>
            {column(d, true)}
          </div>
        ))}
      </div>

      {openItem && (
        <EditItem
          key={openItem.id}
          item={week.items.find((i) => i.id === openItem.id) ?? openItem}
          own={own}
          editable={canEdit && !week.days.find((d) => d.date === openItem.workDate)?.locked}
          step={policy.incrementMinutes}
          max={policy.maxEntryMinutes}
          onClose={() => setOpenItem(null)}
          onSave={(patch) => update.mutate({ item: week.items.find((i) => i.id === openItem.id) ?? openItem, patch })}
          onDelete={() => remove.mutate(week.items.find((i) => i.id === openItem.id) ?? openItem)}
        />
      )}
    </div>
  );
}
