'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { Alert, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { can, useSession } from '@/lib/session';
import type { MeetingDetail } from '@/lib/types';
import { MeetingForm } from '../../_components/meeting-form';

export default function EditMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useSession();
  // Always edit the latest version (no stale cache): the save is rejected anyway if someone published in between.
  const q = useQuery({ queryKey: ['meeting', id, 'edit'], queryFn: () => api<MeetingDetail>(`/meetings/${id}`), staleTime: 0 });
  if (!can(me, 'meeting.write')) return <Alert tone="error">คุณไม่มีสิทธิ์แก้ไขรายงานการประชุม</Alert>;
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error || !q.data) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  return <MeetingForm meeting={q.data} />;
}
