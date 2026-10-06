'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CalendarClock, ExternalLink, MapPin, Pencil, User, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Dialog, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDate } from '@/lib/format';
import { useIntegration } from '@/lib/integrations';
import { type Booking, bkkDate, bkkTime, MODE_LABEL } from '@/lib/rooms';
import { invalidateRooms } from './booking-form';

const SYNC_LABEL = { PENDING: 'รอส่งเข้า Google Calendar', DONE: 'อยู่ใน Google Calendar แล้ว', FAILED: 'ส่งเข้า Google Calendar ไม่สำเร็จ (จะลองใหม่)' } as const;

export function BookingDetail({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (b: Booking) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['room-booking', id], queryFn: () => api<Booking>(`/rooms/bookings/${id}`) });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: (b: Booking) => api<Booking>(`/rooms/bookings/${b.id}/cancel`, { method: 'POST', body: { reason: reason || null, expectedVersion: b.version } }),
    onSuccess: () => {
      toast.success('ยกเลิกการจองแล้ว');
      invalidateRooms(qc);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const b = q.data;
  const google = useIntegration('google_calendar');
  return (
    <Dialog
      open
      onClose={onClose}
      title={b?.title ?? 'การจอง'}
      footer={
        b?.canEdit && (
          <>
            {cancelling ? (
              <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(b)}>
                ยืนยันยกเลิก
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                ยกเลิกการจอง
              </Button>
            )}
            <Button variant="primary" onClick={() => onEdit(b)}>
              <Pencil className="h-3.5 w-3.5" /> แก้ไข
            </Button>
          </>
        )
      }
    >
      {!b ? (
        <p className="text-[13px] text-gray-400">กำลังโหลด…</p>
      ) : (
        <div className="space-y-2.5 text-[13px] text-gray-700">
          <p className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-gray-400" />
            {thaiDate(bkkDate(b.startsAt))} · {bkkTime(b.startsAt)}–{bkkTime(b.endsAt)} น.
            <Badge tone={b.mode === 'ONSITE' ? 'gray' : 'sky'}>{MODE_LABEL[b.mode]}</Badge>
            {b.status === 'CANCELLED' && <Badge tone="rose">ยกเลิกแล้ว</Badge>}
          </p>
          {b.room && (
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gray-400" /> {b.room.name}
              {b.room.location && ` · ${b.room.location}`}
            </p>
          )}
          {b.meetingUrl && (
            <p className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-gray-400" />
              <a href={b.meetingUrl} target="_blank" rel="noopener noreferrer" className="truncate text-brand-600 underline-offset-2 hover:underline">
                {b.meetingUrl}
              </a>
            </p>
          )}
          <p className="flex items-center gap-2">
            <User className="h-4 w-4 text-gray-400" /> ผู้จอง: {b.organizer.fullName}
          </p>
          {b.attendees.length > 0 && (
            <p className="flex items-start gap-2">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span>{b.attendees.map((a) => ('name' in a ? a.name : a.email)).join(', ')}</span>
            </p>
          )}
          {b.description && <p className="rounded-lg bg-gray-50 px-3 py-2 whitespace-pre-line">{b.description}</p>}
          {b.calendar && (
            <p className={`flex items-center gap-1.5 text-[12px] ${b.calendar.status === 'FAILED' ? 'text-rose-600' : 'text-gray-400'}`}>
              <CalendarCheck2 className="h-3.5 w-3.5" />
              {google && google.state !== 'ON' && b.calendar.status === 'PENDING' ? 'ยังไม่เชื่อม Google Calendar — การจองนี้ใช้งานได้ปกติบนเว็บ' : SYNC_LABEL[b.calendar.status]}
            </p>
          )}
          {cancelling && (
            <Field label="เหตุผลที่ยกเลิก (แจ้งผู้เข้าร่วม)">
              <input className={inputClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
          )}
        </div>
      )}
    </Dialog>
  );
}
