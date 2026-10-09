'use client';

/**
 * TRCLOUD sync state shared by the customers page and the revenue tab. The server syncs on a timer; opening either
 * page also asks for a sync, which the server skips when the last one is recent (contacts → customers, then the last
 * 12 months of revenue from the invoice report).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from './api';

export interface TrcloudSyncs {
  lastContactSync: { at: string; created: number; linked: number; renamed: number; removed: number; closed: number; needsDecision: number; removalHeld: number } | null;
  lastInvoiceSync: { at: string; from: string; to: string; rows: number; total: number; unmatched: number; byCompany: Record<string, { rows: number; total: number }> } | null;
}
export interface TrcloudStatus extends TrcloudSyncs {
  enabled: boolean;
  /** The group's companies connected (PAS, PC, PA), priority order. */
  companies: string[];
}

export const trcloudStatusQuery = { queryKey: ['trcloud-status'], queryFn: () => api<TrcloudStatus>('/revenue/trcloud/status'), staleTime: 60_000 };

export const syncedAt = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

/** Status + a refresh that runs once when the page opens (and again on demand with force). */
export function useTrcloudSync() {
  const qc = useQueryClient();
  const status = useQuery(trcloudStatusQuery);
  const refresh = useMutation({
    mutationFn: (force: boolean) => api<TrcloudSyncs & { ran: boolean }>('/revenue/trcloud/refresh', { method: 'POST', body: { force } }),
    onSuccess: (r, force) => {
      if (r.ran) for (const key of ['admin-customers', 'customers', 'analytics', 'revenue-batches']) void qc.invalidateQueries({ queryKey: [key] });
      void qc.invalidateQueries({ queryKey: ['trcloud-status'] });
      if (force) toast.success('ซิงก์ลูกค้าและรายได้จาก TRCLOUD แล้ว');
    },
    onError: (e, force) => {
      if (force) toast.error(errorMessage(e));
    },
  });
  const started = useRef(false);
  const enabled = !!status.data?.enabled;
  const { mutate } = refresh;
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    mutate(false);
  }, [enabled, mutate]);
  return { status, refresh };
}
