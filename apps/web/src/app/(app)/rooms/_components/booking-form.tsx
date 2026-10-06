'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Laptop, MonitorSmartphone, Search, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Button, Dialog, Field, inputClass } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { type Person, personLabel } from '@/lib/leave';
import { type Booking, type BookingMode, bkkDate, bkkMinutes, hhmm, MODE_LABEL, type Room, toInstant } from '@/lib/rooms';
import { useSession } from '@/lib/session';

export interface BookingDraft {
  roomId?: string | null;
  date: string;
  start: number; // minutes since midnight
  end: number;
}

const TIMES = Array.from({ length: (21 - 7) * 4 + 1 }, (_, i) => 7 * 60 + i * 15);

export function invalidateRooms(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['room-bookings', 'room-bookings-mine', 'calendar-sync']) void qc.invalidateQueries({ queryKey: [key] });
}

/** New booking (draft) or edit (booking). Online = link only; hybrid = room + link. */
export function BookingForm({ rooms, draft, booking, onClose }: { rooms: Room[]; draft?: BookingDraft; booking?: Booking; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useSession();
  const [title, setTitle] = useState(booking?.title ?? '');
  const [mode, setMode] = useState<BookingMode>(booking?.mode ?? 'ONSITE');
  const [roomId, setRoomId] = useState(booking?.room?.id ?? draft?.roomId ?? rooms[0]?.id ?? '');
  const [date, setDate] = useState(booking ? bkkDate(booking.startsAt) : draft!.date);
  const [start, setStart] = useState(booking ? bkkMinutes(booking.startsAt) : draft!.start);
  const [end, setEnd] = useState(booking ? bkkMinutes(booking.endsAt) : draft!.end);
  const [description, setDescription] = useState(booking?.description ?? '');
  const [meetingUrl, setMeetingUrl] = useState(booking?.meetingUrl ?? '');
  const [attendeeIds, setAttendeeIds] = useState<string[]>(booking?.attendees.flatMap((a) => ('employeeId' in a ? [a.employeeId] : [])) ?? []);
  const [guests, setGuests] = useState(booking?.attendees.flatMap((a) => ('email' in a ? [a.email] : [])).join(', ') ?? '');
  const [search, setSearch] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);

  const people = useQuery({ queryKey: ['directory'], queryFn: () => api<Person[]>('/employees/directory'), staleTime: 300_000 });
  const others = (people.data ?? []).filter((p) => p.id !== me.user.id);
  const picked = others.filter((p) => attendeeIds.includes(p.id));
  const matches = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return [];
    return others.filter((p) => !attendeeIds.includes(p.id) && `${p.fullName} ${p.nickname ?? ''} ${p.orgUnit?.name ?? ''}`.toLowerCase().includes(s)).slice(0, 6);
  }, [search, others, attendeeIds]);

  const room = rooms.find((r) => r.id === roomId);
  const guestList = guests
    .split(/[\s,;]+/)
    .map((g) => g.trim())
    .filter(Boolean);
  const headcount = 1 + attendeeIds.length + guestList.length;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        mode,
        roomId: mode === 'ONLINE' ? null : roomId,
        startsAt: toInstant(date, hhmm(start)),
        endsAt: toInstant(date, hhmm(end)),
        description: description || null,
        meetingUrl: mode === 'ONSITE' ? null : meetingUrl || null,
        attendeeIds,
        guestEmails: guestList,
      };
      return booking
        ? api<Booking>(`/rooms/bookings/${booking.id}`, { method: 'PATCH', body: { ...body, expectedVersion: booking.version } })
        : api<Booking>('/rooms/bookings', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success(booking ? 'บันทึกการแก้ไขแล้ว' : 'จองแล้ว — ผู้เข้าร่วมจะเห็นในปฏิทิน');
      invalidateRooms(qc);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ROOM_TAKEN') setConflict(e.message);
      else toast.error(errorMessage(e));
    },
  });

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={booking ? 'แก้ไขการจอง' : 'จองห้องประชุม'}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" disabled={!title.trim() || end <= start || (mode !== 'ONLINE' && !roomId)} loading={save.isPending} onClick={() => save.mutate()}>
            {booking ? 'บันทึก' : 'จอง'}
          </Button>
        </>
      }
    >
      <Field label="หัวข้อ">
        <input className={inputClass} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ประชุมปิดงบ ลูกค้า A001" autoFocus />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['ONSITE', Building2, 'จองห้องที่บริษัท'],
            ['ONLINE', Laptop, 'ลิงก์ประชุมอย่างเดียว'],
            ['HYBRID', MonitorSmartphone, 'ห้อง + ลิงก์'],
          ] as const
        ).map(([k, Icon, hint]) => (
          <button
            key={k}
            type="button"
            onClick={() => setMode(k)}
            className={`rounded-lg px-3 py-2.5 text-left ring-1 transition ring-inset ${mode === k ? 'bg-brand-50/70 ring-2 ring-brand-500' : 'ring-gray-200 hover:bg-gray-50'}`}
          >
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-gray-900">
              <Icon className="h-4 w-4 text-brand-600" /> {MODE_LABEL[k]}
            </span>
            <span className="mt-0.5 block text-[11.5px] text-gray-500">{hint}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {mode !== 'ONLINE' && (
          <Field label="ห้อง">
            <select className={inputClass} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.capacity ? ` (${r.capacity} คน)` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="วันที่">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="เริ่ม">
          <select className={inputClass} value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {TIMES.map((t) => (
              <option key={t} value={t}>
                {hhmm(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ถึง">
          <select className={inputClass} value={end} onChange={(e) => setEnd(Number(e.target.value))}>
            {TIMES.filter((t) => t > start).map((t) => (
              <option key={t} value={t}>
                {hhmm(t)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {conflict && <Alert tone="error">{conflict}</Alert>}
      {room?.capacity && mode !== 'ONLINE' && headcount > room.capacity && <Alert tone="warning">ผู้เข้าร่วม {headcount} คน เกินความจุห้อง ({room.capacity} คน)</Alert>}

      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-gray-700">
          <Users className="h-3.5 w-3.5" /> ผู้เข้าร่วม (ได้รับคำเชิญและแจ้งเตือนในปฏิทิน)
        </span>
        {picked.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2.5 text-[12px] text-brand-800">
                {personLabel(p)}
                <button type="button" aria-label="นำออก" onClick={() => setAttendeeIds((x) => x.filter((id) => id !== p.id))} className="rounded-full p-0.5 hover:bg-brand-100">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input className={`${inputClass} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="พิมพ์ชื่อ ชื่อเล่น หรือทีม" />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg bg-white shadow-pop ring-1 ring-gray-200">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-gray-50"
                    onClick={() => {
                      setAttendeeIds((x) => [...x, p.id]);
                      setSearch('');
                    }}
                  >
                    <span>{personLabel(p)}</span>
                    <span className="text-[12px] text-gray-400">{p.orgUnit?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Field label="แขกภายนอก (อีเมล คั่นด้วยจุลภาค)" hint="เช่น ลูกค้า — จะได้รับคำเชิญทางอีเมลเมื่อเชื่อม Google Calendar แล้ว">
        <input className={inputClass} value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="owner@customer.co.th" />
      </Field>

      {mode !== 'ONSITE' && (
        <Field label="ลิงก์ประชุม (ไม่บังคับ)" hint="เว้นว่างได้ — เมื่อเชื่อม Google Calendar ระบบสร้างลิงก์ Google Meet ให้อัตโนมัติ">
          <input className={inputClass} value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://meet.google.com/... หรือ Zoom" />
        </Field>
      )}

      <Field label="รายละเอียด / วาระ (ไม่บังคับ)">
        <textarea className={inputClass} rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Dialog>
  );
}
