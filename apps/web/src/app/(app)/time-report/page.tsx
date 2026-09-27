import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverApi, UnauthenticatedError } from '@/lib/server-api';
import type { MonthSummary, WeekView } from '@/lib/types';
import { Timesheet } from './_components/timesheet';

export const metadata: Metadata = { title: 'บันทึกเวลา' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Server Component: fetches the requested view on the server (next to the API) and streams HTML
 * that already contains the data. The client hydrates it into React Query — no loading spinner,
 * no client-side request waterfall. Later week/month switches happen purely on the client.
 */
export default async function TimeReportPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const view = one(sp.view) === 'month' ? 'month' : 'week';
  const employeeId = one(sp.employeeId);
  const qs = new URLSearchParams();
  if (employeeId && /^[0-9a-f-]{36}$/i.test(employeeId)) qs.set('employeeId', employeeId);

  try {
    if (view === 'month') {
      const month = one(sp.month);
      const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()).slice(0, 7);
      qs.set('month', m);
      const data = await serverApi<MonthSummary>(`/time-report/month-summary?${qs}`);
      return <Timesheet initialMonth={data} />;
    }
    const date = one(sp.date);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) qs.set('date', date);
    const data = await serverApi<WeekView>(`/time-report/week?${qs}`);
    return <Timesheet initialWeek={data} />;
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect('/login');
    throw e;
  }
}
