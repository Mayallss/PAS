import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverApi, UnauthenticatedError } from '@/lib/server-api';
import type { PlanWeek } from '@/lib/types';
import { Planner } from './_components/planner';

export const metadata: Metadata = { title: 'แผนงาน' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Server-renders the requested week so the board appears with data (same pattern as the timesheet). */
export default async function PlanPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  const date = one(sp.date);
  const employeeId = one(sp.employeeId);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) qs.set('date', date);
  if (employeeId && /^[0-9a-f-]{36}$/i.test(employeeId)) qs.set('employeeId', employeeId);
  try {
    const initial = one(sp.view) === 'team' ? undefined : await serverApi<PlanWeek>(`/todos/week?${qs}`);
    return <Planner initial={initial} />;
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect('/login');
    throw e;
  }
}
