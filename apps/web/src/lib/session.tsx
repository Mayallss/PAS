'use client';

import { createContext, useContext, useState } from 'react';
import { setCsrfToken } from './api';
import type { Me, Permission } from './types';

const SessionContext = createContext<Me | null>(null);

/** Receives the session resolved on the server — no client-side /me request, no loading flash. */
export function SessionProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  useState(() => setCsrfToken(me.csrfToken)); // set before any child effect can fire a mutation
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession outside SessionProvider');
  return me;
}

/** Compatibility shape for pages written against the query-based hook. */
export function useMe() {
  return { data: useSession(), isLoading: false as const };
}

export function can(me: Me | undefined, ...perms: Permission[]) {
  return !!me && perms.some((p) => me.user.permissions.includes(p));
}
