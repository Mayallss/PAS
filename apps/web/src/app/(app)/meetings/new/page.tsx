'use client';

import { Alert } from '@/components/ui';
import { can, useSession } from '@/lib/session';
import { MeetingForm } from '../_components/meeting-form';

export default function NewMeetingPage() {
  const me = useSession();
  if (!can(me, 'meeting.write')) return <Alert tone="error">คุณไม่มีสิทธิ์บันทึกรายงานการประชุม</Alert>;
  return <MeetingForm />;
}
