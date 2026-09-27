import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { serverApi, UnauthenticatedError } from '@/lib/server-api';
import { SessionProvider } from '@/lib/session';
import type { Me } from '@/lib/types';

/** Session is resolved on the server; pages render already knowing the user and permissions. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let me: Me;
  try {
    me = await serverApi<Me>('/auth/me');
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect('/login');
    throw e;
  }
  return (
    <SessionProvider me={me}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
