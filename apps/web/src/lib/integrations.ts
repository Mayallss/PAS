'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** Optional integrations (API /integrations). The core works without them; pages use this to explain what is missing. */
export type IntegrationKey = 'google_login' | 'google_calendar' | 'monday' | 'trcloud';
export interface Integration {
  key: IntegrationKey;
  name: string;
  state: 'ON' | 'OFF' | 'ERROR';
  whenOff: string;
  issues?: string[];
  pending?: number;
  failed?: number;
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => api<{ items: Integration[] }>('/integrations'),
    staleTime: 5 * 60_000,
    retry: 1,
    select: (d) => d.items,
  });
}

/** null while loading or if the status itself is unavailable — callers then simply show no hint. */
export function useIntegration(key: IntegrationKey): Integration | null {
  const q = useIntegrations();
  return q.data?.find((i) => i.key === key) ?? null;
}
