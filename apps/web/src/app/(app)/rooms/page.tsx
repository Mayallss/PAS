'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, DoorOpen, Laptop, MapPin, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, THAI_WEEKDAY_LONG, thaiDate, thaiDateShort, todayBangkok } from '@/lib/format';
import { type Booking, bkkDate, bkkMinutes, bkkTime, type Room, toInstant } from '@/lib/rooms';
import { can, useSession } from '@/lib/session';
import { CalendarSyncCard } from '../leave/_components/hr-admin';
import { RoomBoard } from './_components/board';
import { BookingDetail } from './_components/booking-detail';
import { BookingForm, type BookingDraft } from './_components/booking-form';
import { IntegrationHint } from '@/components/integration-hint';
import { Optional } from '@/components/optional';
import { RoomAdmin } from './_components/room-admin';

const weekday = (iso: string) => THAI_WEEKDAY_LONG[new Date(`${iso}T00:00:00Z`).getUTCDay() || 7];

/**
 * จองห้องประชุม (docs/09). One board per day; online meetings need no room. Once Google Workspace is connected,
 * every booking is mirrored to the organizer's Google Calendar (invites, phone reminders, Meet link, room calendar).
 */
export default function RoomsPage() {
  const me = useSession();
  const manage = can(me, 'room.manage');
  const today = todayBangkok();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);

  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api<Room[]>('/rooms') });
  const day = useQuery({
    queryKey: ['room-bookings', date],
    queryFn: () => api<Booking[]>('/rooms/bookings', { query: { from: toInstant(date, '00:00'), to: toInstant(addDays(date, 1), '00:00') } }),
    refetchInterval: 60_000,
  });
  const mine = useQuery({ queryKey: ['room-bookings-mine'], queryFn: () => api<Booking[]>('/rooms/bookings/mine') });

  const nowMinutes = date === today ? bkkMinutes(new Date().toISOString()) : null;
  const nextSlot = (() => {
    const m = nowMinutes ?? 9 * 60;
    const s = Math.max(8 * 60, Math.ceil((m + 1) / 30) * 30);
    return Math.min(s, 18 * 60);
  })();

  return (
    <div>
      <PageHeader
        title="จองห้องประชุม"
        description="จองห้องที่บริษัท หรือนัดประชุมออนไลน์ — คลิกช่องว่างบนตารางเพื่อจองเวลานั้น"
        actions={
          <>
            {manage && (
              <Button onClick={() => setAdmin(true)}>
                <Settings2 className="h-4 w-4" /> จัดการห้อง
              </Button>
            )}
            <Button variant="primary" disabled={!rooms.data} onClick={() => setDraft({ date, start: nextSlot, end: nextSlot + 60, roomId: rooms.data?.[0]?.id })}>
              <CalendarPlus className="h-4 w-4" /> จองห้อง / นัดประชุม
            </Button>
          </>
        }
      />

      <IntegrationHint integration="google_calendar" className="mb-4" />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="icon" variant="ghost" aria-label="วันก่อน" onClick={() => setDate(addDays(date, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input type="date" className="h-9 rounded-lg border-0 px-3 text-sm shadow-card ring-1 ring-gray-200 ring-inset" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button size="icon" variant="ghost" aria-label="วันถัดไป" onClick={() => setDate(addDays(date, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {date !== today && (
              <Button size="sm" variant="ghost" onClick={() => setDate(today)}>
                วันนี้
              </Button>
            )}
            <span className="text-[13px] font-medium text-gray-700">
              วัน{weekday(date)}ที่ {thaiDate(date)}
            </span>
          </div>
          {rooms.isLoading || day.isLoading ? (
            <Loading rows={4} />
          ) : rooms.data?.length ? (
            <RoomBoard
              rooms={rooms.data}
              bookings={day.data ?? []}
              nowMinutes={nowMinutes}
              onPick={(roomId, start) => setDraft({ roomId, date, start, end: start + 60 })}
              onOpen={(b) => setOpenId(b.id)}
            />
          ) : (
            <Empty icon={<DoorOpen className="h-5 w-5" />} title="ยังไม่มีห้องประชุม">
              {manage ? 'กด “จัดการห้อง” เพื่อเพิ่มห้อง' : 'ติดต่อผู้ดูแลเพื่อเพิ่มห้องประชุม'}
            </Empty>
          )}
        </div>

        <div className="space-y-4">
          <Card title="การประชุมของฉัน" description="ที่ฉันจองหรือได้รับเชิญ" bodyClassName="p-0">
            {mine.data?.length ? (
              <ul className="divide-y divide-gray-100">
                {mine.data.slice(0, 8).map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => setOpenId(b.id)} className="w-full px-4 py-2.5 text-left hover:bg-gray-50">
                      <p className="truncate text-[13px] font-medium text-gray-900">{b.title}</p>
                      <p className="flex items-center gap-1.5 text-[12px] text-gray-500">
                        <CalendarClock className="h-3 w-3" />
                        {thaiDateShort(bkkDate(b.startsAt))} {bkkTime(b.startsAt)}–{bkkTime(b.endsAt)}
                        {b.room ? (
                          <>
                            <MapPin className="ml-1 h-3 w-3" /> {b.room.name}
                          </>
                        ) : (
                          <>
                            <Laptop className="ml-1 h-3 w-3" /> ออนไลน์
                          </>
                        )}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-[13px] text-gray-400">ไม่มีนัดที่จะถึง</p>
            )}
          </Card>
          {(manage || can(me, 'leave.manage')) && (
            <Optional name="calendar-sync">
              <CalendarSyncCard />
            </Optional>
          )}
        </div>
      </div>

      {rooms.data && (draft || editing) && (
        <BookingForm
          key={editing?.id ?? `${draft?.roomId}-${draft?.start}`}
          rooms={rooms.data}
          draft={draft ?? undefined}
          booking={editing ?? undefined}
          onClose={() => {
            setDraft(null);
            setEditing(null);
          }}
        />
      )}
      {openId && (
        <BookingDetail
          id={openId}
          onClose={() => setOpenId(null)}
          onEdit={(b) => {
            setOpenId(null);
            setEditing(b);
          }}
        />
      )}
      {admin && <RoomAdmin onClose={() => setAdmin(false)} />}
    </div>
  );
}
