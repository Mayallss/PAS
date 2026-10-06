'use client';

import { AlarmClock, ChevronRight } from 'lucide-react';
import { Alert, Card, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { addDays, THAI_WEEKDAY_SHORT, weekLabel } from '@/lib/format';
import { Header, Stepper } from '../../time-report/_components/timesheet';
import { useTeamPlan } from '../_lib/plan-data';
import { hrs } from './plan-style';

type Navigate = (next: { view?: 'board' | 'team'; date?: string; employeeId?: string | null }) => void;

/** Legacy "To Do List : ทีม / ทั้งหมด", as a heat map: is everyone's week planned, and did the plan happen? */
export function TeamBoard({ date, today, toggle, navigate }: { date: string; today: string; toggle: React.ReactNode; navigate: Navigate }) {
  const q = useTeamPlan(date, true);
  const plan = q.data;

  return (
    <div>
      <Header title="แผนงาน · ภาพรวมทีม" subtitle="ชั่วโมงที่วางแผนเทียบกับชั่วโมงที่ต้องทำ และเวลาจริงที่ลงแล้ว — คลิกชื่อเพื่อดู/มอบหมายงาน">
        {toggle}
        {plan && (
          <Stepper
            label={weekLabel(plan.weekStart, addDays(plan.weekStart, 6))}
            onPrev={() => navigate({ date: addDays(plan.weekStart, -7) })}
            onNext={() => navigate({ date: addDays(plan.weekStart, 7) })}
            onToday={() => navigate({ date: today })}
            isCurrent={plan.dates.includes(today)}
          />
        )}
      </Header>

      <Card bodyClassName="p-0">
        {q.isLoading ? (
          <div className="p-5"><Loading rows={5} /></div>
        ) : q.error || !plan ? (
          <div className="p-5"><Alert tone="error">{errorMessage(q.error)}</Alert></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className="border-b border-gray-200 text-[12px] text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">พนักงาน</th>
                  {plan.dates.map((d) => (
                    <th key={d} className={`px-1 py-2 text-center font-medium ${d === today ? 'text-brand-700' : ''}`}>
                      {THAI_WEEKDAY_SHORT[new Date(`${d}T00:00:00Z`).getUTCDay() || 7]} {Number(d.slice(8))}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">รวมแผน / จริง</th>
                </tr>
              </thead>
              <tbody>
                {plan.people.map((p) => {
                  const planned = p.days.reduce((a, d) => a + d.plannedMinutes, 0);
                  const actual = p.days.reduce((a, d) => a + d.actualMinutes, 0);
                  return (
                    <tr key={p.employee.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => navigate({ view: 'board', employeeId: p.employee.id, date })}
                          className="group flex items-center gap-1 text-left"
                        >
                          <span>
                            <span className="font-medium text-gray-900 group-hover:text-brand-700">{p.employee.fullName}</span>
                            {p.employee.nickname && <span className="text-gray-500"> ({p.employee.nickname})</span>}
                            <span className="block text-[11.5px] text-gray-400">{p.employee.team ?? '–'}</span>
                          </span>
                          <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-brand-600" />
                        </button>
                        {p.lateItems > 0 && (
                          <span className="mt-0.5 flex items-center gap-1 text-[11.5px] font-medium text-rose-700">
                            <AlarmClock className="h-3 w-3" /> งานเลยกำหนด {p.lateItems}
                          </span>
                        )}
                      </td>
                      {p.days.map((d) => {
                        const none = d.requiredMinutes === 0 && d.plannedMinutes === 0;
                        const tone = none
                          ? 'bg-transparent text-gray-300'
                          : d.plannedMinutes === 0
                            ? 'bg-rose-50 text-rose-700'
                            : d.plannedMinutes > d.requiredMinutes
                              ? 'bg-violet-50 text-violet-700'
                              : d.plannedMinutes >= d.requiredMinutes
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-800';
                        return (
                          <td key={d.date} className="px-1 py-1.5 text-center">
                            <div className={`rounded-md px-1.5 py-1 tabular-nums ${tone}`} title={`แผน ${hrs(d.plannedMinutes)} · ต้องทำ ${hrs(d.requiredMinutes)} · จริง ${hrs(d.actualMinutes)}`}>
                              <span className="block text-[12.5px] font-medium">{none ? '–' : `${d.plannedMinutes / 60}/${d.requiredMinutes / 60}`}</span>
                              {d.actualMinutes > 0 && <span className="block text-[10.5px] opacity-75">จริง {d.actualMinutes / 60}</span>}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {hrs(planned)} / {hrs(actual)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-[11.5px] text-gray-500">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />วางแผนครบ</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />ยังไม่ครบ</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-400" />ยังไม่มีแผน</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-400" />เกินชั่วโมงทำงาน</span>
              <span>ตัวเลข = ชม.แผน / ชม.ที่ต้องทำ</span>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
