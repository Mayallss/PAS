import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverApi, UnauthenticatedError } from '@/lib/server-api';
import type { HomeData } from '@/lib/types';
import { Home } from './_home/home';

export const metadata: Metadata = { title: 'หน้าหลัก' };

/** Employee portal: one server-side request (`/api/home`) renders the whole page. */
export default async function HomePage() {
  try {
    const data = await serverApi<HomeData>('/home');
    return <Home initial={data} />;
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect('/login');
    throw e;
  }
}
