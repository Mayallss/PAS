'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, Inbox, Palmtree, UserCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Badge, Button, Card, Empty, Loading, PageHeader, Progress } from '@/components/ui';
import { api } from '@/lib/api';
import { todayBangkok } from '@/lib/format';
import { daysText, type LeaveRequest, type MyLeave, typeColor } from '@/lib/leave';
import { can, useSession } from '@/lib/session';
import { HrAdmin } from './_components/hr-admin';
import { LeaveForm } from './_components/leave-form';
import { RequestRow } from './_components/request-row';
import { IntegrationHint } from '@/components/integration-hint';
import { TeamCalendar } from './_components/team-calendar';

type Tab = 'mine' | 'approvals' | 'calendar' | 'hr';

export default function LeavePage() {
  return (
    <Suspense fallback={<Loading rows={6} />}>
      <Leave />
    </Suspense>
  );
}

/**
 * การลา (docs/09): everyone files their own leave; the team lead approves; approval posts the leave into the
 * timesheet. HR (`leave.manage`) sees everything, adjusts entitlements and records leave on someone's behalf.
 */
function Leave() {
  const me = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const hr = can(me, 'leave.manage');
  const [year, setYear] = useState(Number(todayBangkok().slice(0, 4)));
  const [filing, setFiling] = useState<'self' | 'hr' | null>(null);

  const mine = useQuery({ queryKey: ['leave-me', year], queryFn: () => api<MyLeave>('/leave/me', { query: { year } }) });
  const approvals = useQuery({ queryKey: ['leave-approvals'], queryFn: () => api<LeaveRequest[]>('/leave/approvals') });
  const waiting = (approvals.data ?? []).filter((r) => !hr || r.inMyTeams || r.noTeamApprover).length;
  const isApprover = hr || (approvals.data?.length ?? 0) > 0;

  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested === 'approvals' && isApprover ? 'approvals' : requested === 'hr' && hr ? 'hr' : requested === 'calendar' ? 'calendar' : 'mine';
  const setTab = (t: Tab) => router.replace(t === 'mine' ? '/leave' : `/leave?tab=${t}`, { scroll: false });

  return (
    <div>
      <PageHeader
        title="การลา"
        description={mine.data?.approver ? `ยื่นใบลา ดูสิทธิ์คงเหลือ · ผู้อนุมัติของคุณ: ${mine.data.approver}` : 'ยื่นใบลา ดูสิทธิ์คงเหลือ · ใบลาของคุณจะส่งให้ HR พิจารณา'}
        actions={
          <Button variant="primary" onClick={() => setFiling('self')} disabled={!mine.data}>
            <CalendarPlus className="h-4 w-4" /> ยื่นใบลา
          </Button>
        }
      />

      <IntegrationHint integration="google_calendar" className="mb-4" />

      <div role="tablist" className="mb-4 inline-flex flex-wrap rounded-lg bg-gray-100 p-1">
        {(
          [
            ['mine', 'ของฉัน', true],
            ['approvals', 'รออนุมัติ', isApprover],
            ['calendar', 'ปฏิทินทีม', true],
            ['hr', 'จัดการ (HR)', hr],
          ] as [Tab, string, boolean][]
        )
          .filter(([, , show]) => show)
          .map(([k, label]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium ${tab === k ? 'bg-white shadow-card' : 'text-gray-500'}`}>
              {label}
              {k === 'approvals' && waiting > 0 && <Badge tone="rose">{waiting}</Badge>}
            </button>
          ))}
      </div>

      {tab === 'mine' && (mine.isLoading || !mine.data ? <Loading rows={5} /> : <MyLeaveView data={mine.data} year={year} onYear={setYear} />)}
      {tab === 'approvals' && <Approvals list={approvals.data} loading={approvals.isLoading} hr={hr} />}
      {tab === 'calendar' && <TeamCalendar />}
      {tab === 'hr' && <HrAdmin onRecord={() => setFiling('hr')} />}

      {mine.data && <LeaveForm open={filing !== null} hrMode={filing === 'hr'} onClose={() => setFiling(null)} balances={mine.data.balances} />}
    </div>
  );
}

function MyLeaveView({ data, year, onYear }: { data: MyLeave; year: number; onYear: (y: number) => void }) {
  const now = Number(data.today.slice(0, 4));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {data.balances.map((b) => {
          const c = typeColor(b.type.color);
          const used = b.usedMinutes + b.pendingMinutes;
          return (
            <section key={b.type.id} className="rounded-xl bg-white p-4 shadow-card ring-1 ring-gray-200/80">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[13px] font-medium text-gray-700">
                  <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} /> {b.type.name}
                </h3>
                {b.overridden && <Badge tone="brand">ปรับโดย HR</Badge>}
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">
                {daysText(b.remainingMinutes)}
                <span className="ml-1 text-[13px] font-normal text-gray-400">คงเหลือ</span>
              </p>
              {b.entitledMinutes != null && <Progress className="mt-3" value={used} max={Math.max(b.entitledMinutes, 1)} barClassName={c.bar} />}
              <p className="mt-2 text-[12px] text-gray-500">
                ใช้ไป {daysText(b.usedMinutes)}
                {b.pendingMinutes > 0 && ` · รออนุมัติ ${daysText(b.pendingMinutes)}`} · สิทธิ์ {daysText(b.entitledMinutes)}
              </p>
              {b.entitledMinutes === 0 && b.type.key === 'VACATION' && <p className="mt-1 text-[12px] text-amber-700">ได้สิทธิ์พักร้อนเมื่อทำงานครบ 1 ปี</p>}
            </section>
          );
        })}
      </div>

      <Card
        title="ใบลาของฉัน"
        actions={
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
            {[now - 1, now, now + 1].map((y) => (
              <button key={y} type="button" onClick={() => onYear(y)} className={`h-7 rounded-md px-2.5 text-[12px] font-medium ${y === year ? 'bg-white shadow-card' : 'text-gray-500'}`}>
                {y + 543}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-0"
      >
        {data.requests.length ? (
          <ul className="divide-y divide-gray-100">
            {data.requests.map((r) => (
              <RequestRow key={r.id} r={r} mode="mine" />
            ))}
          </ul>
        ) : (
          <Empty icon={<Palmtree className="h-5 w-5" />} title={`ยังไม่มีใบลาปี ${year + 543}`}>
            กด “ยื่นใบลา” — ระบบนับเฉพาะวันทำงาน และลงบันทึกเวลาให้เมื่ออนุมัติ
          </Empty>
        )}
      </Card>
    </div>
  );
}

function Approvals({ list, loading, hr }: { list?: LeaveRequest[]; loading: boolean; hr: boolean }) {
  if (loading) return <Loading rows={4} />;
  const mineFirst = [...(list ?? [])].sort((a, b) => Number(Boolean(b.inMyTeams || b.noTeamApprover)) - Number(Boolean(a.inMyTeams || a.noTeamApprover)));
  return (
    <Card
      title="ใบลารออนุมัติ"
      description={hr ? 'HR เห็นทุกใบ — ใบที่มีหัวหน้าทีมดูแลอยู่แล้วให้หัวหน้าพิจารณาก่อน' : 'ใบลาของทีมที่คุณดูแล'}
      bodyClassName="p-0"
    >
      {mineFirst.length ? (
        <ul className="divide-y divide-gray-100">
          {mineFirst.map((r) => (
            <RequestRow key={r.id} r={r} mode="approver" />
          ))}
        </ul>
      ) : (
        <Empty icon={<Inbox className="h-5 w-5" />} title="ไม่มีใบลารออนุมัติ">
          <span className="inline-flex items-center gap-1">
            <UserCheck className="h-3.5 w-3.5" /> เรียบร้อยทั้งหมด
          </span>
        </Empty>
      )}
    </Card>
  );
}
