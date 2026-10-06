'use client';

import { Laptop, Users } from 'lucide-react';
import { BOARD_END, BOARD_START, type Booking, bkkMinutes, bkkTime, hhmm, type Room, roomColor } from '@/lib/rooms';

const SPAN = BOARD_END - BOARD_START;
const pct = (m: number) => `${((Math.min(Math.max(m, BOARD_START), BOARD_END) - BOARD_START) / SPAN) * 100}%`;
const HOURS = Array.from({ length: (BOARD_END - BOARD_START) / 60 + 1 }, (_, i) => BOARD_START + i * 60);

/**
 * One day, rooms as rows, 08:00–19:00. Click an empty spot to book it (snapped to 30 min).
 * The red line is "now" when looking at today.
 */
export function RoomBoard({
  rooms,
  bookings,
  nowMinutes,
  onPick,
  onOpen,
}: {
  rooms: Room[];
  bookings: Booking[];
  nowMinutes: number | null;
  onPick: (roomId: string, start: number) => void;
  onOpen: (b: Booking) => void;
}) {
  const online = bookings.filter((b) => !b.room);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl bg-white shadow-card ring-1 ring-gray-200/80">
        <div className="min-w-[38rem]">
          <div className="relative ml-36 h-7 border-b border-gray-100 text-[11px] text-gray-400">
            {HOURS.map((h) => (
              <span key={h} className={`absolute top-1.5 ${h === BOARD_END ? '-translate-x-full pr-1' : h === BOARD_START ? 'pl-1' : '-translate-x-1/2'}`} style={{ left: pct(h) }}>
                {hhmm(h)}
              </span>
            ))}
          </div>
          {rooms.map((room) => {
            const mine = bookings.filter((b) => b.room?.id === room.id);
            return (
              <div key={room.id} className="flex border-b border-gray-50 last:border-0">
                <div className="w-36 shrink-0 px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-gray-900">
                    <span className={`h-2 w-2 rounded-full ${roomColor(room.color)}`} /> {room.name}
                  </p>
                  <p className="text-[11.5px] text-gray-400">
                    {[room.location, room.capacity && `${room.capacity} คน`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div
                  className="relative h-16 flex-1 cursor-copy bg-[repeating-linear-gradient(90deg,transparent,transparent_calc(100%/22-1px),rgb(243_244_246)_calc(100%/22-1px),rgb(243_244_246)_calc(100%/22))]"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const m = BOARD_START + ((e.clientX - r.left) / r.width) * SPAN;
                    onPick(room.id, Math.max(BOARD_START, Math.min(BOARD_END - 30, Math.floor(m / 30) * 30)));
                  }}
                  role="presentation"
                >
                  {nowMinutes != null && nowMinutes > BOARD_START && nowMinutes < BOARD_END && <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-400" style={{ left: pct(nowMinutes) }} />}
                  {mine.map((b) => {
                    const s = bkkMinutes(b.startsAt);
                    const e = bkkMinutes(b.endsAt) || 24 * 60;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onOpen(b);
                        }}
                        title={`${b.title} · ${bkkTime(b.startsAt)}–${bkkTime(b.endsAt)} · ${b.organizer.fullName}`}
                        className={`absolute inset-y-1.5 overflow-hidden rounded-md px-2 py-1 text-left text-white shadow-sm transition hover:brightness-110 ${roomColor(room.color)}`}
                        style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)} - 2px)` }}
                      >
                        <span className="block truncate text-[12px] font-medium">{b.title}</span>
                        <span className="block truncate text-[11px] opacity-90">
                          {bkkTime(b.startsAt)}–{bkkTime(b.endsAt)} · {b.organizer.nickname ?? b.organizer.fullName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {online.length > 0 && (
        <div className="rounded-xl bg-white p-3 shadow-card ring-1 ring-gray-200/80">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-gray-500">
            <Laptop className="h-3.5 w-3.5" /> ประชุมออนไลน์วันนี้ (ไม่ใช้ห้อง)
          </p>
          <ul className="flex flex-wrap gap-2">
            {online.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => onOpen(b)} className="inline-flex items-center gap-2 rounded-lg bg-sky-50 px-2.5 py-1.5 text-[12.5px] text-sky-900 ring-1 ring-sky-200 ring-inset hover:bg-sky-100">
                  <span className="font-medium">
                    {bkkTime(b.startsAt)}–{bkkTime(b.endsAt)}
                  </span>
                  {b.title}
                  <span className="inline-flex items-center gap-0.5 text-sky-700">
                    <Users className="h-3 w-3" /> {b.attendees.length + 1}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
