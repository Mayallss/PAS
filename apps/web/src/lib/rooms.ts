/** Meeting rooms and bookings (docs/09). Times are ISO instants; the UI works in Bangkok time (UTC+7, no DST). */

export type BookingMode = 'ONSITE' | 'ONLINE' | 'HYBRID';

export interface Room {
  id: string;
  name: string;
  location: string | null;
  capacity: number | null;
  features: string[];
  googleResourceEmail: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  note: string | null;
}

export interface Booking {
  id: string;
  title: string;
  mode: BookingMode;
  room: { id: string; name: string; location: string | null; color: string | null; capacity: number | null } | null;
  startsAt: string;
  endsAt: string;
  organizer: { id: string; fullName: string; nickname: string | null };
  description: string | null;
  meetingUrl: string | null;
  status: 'CONFIRMED' | 'CANCELLED';
  cancelReason: string | null;
  attendees: ({ employeeId: string; name: string } | { email: string })[];
  meeting: { id: string; title: string } | null;
  version: number;
  canEdit: boolean;
  calendar: { status: 'PENDING' | 'DONE' | 'FAILED'; lastError: string | null } | null;
}

export interface SyncStatus {
  configured: boolean;
  companyCalendar: boolean;
  pending: number;
  done: number;
  failed: number;
  lastFailure: { kind: string; lastError: string | null; updatedAt: string } | null;
}

export const MODE_LABEL: Record<BookingMode, string> = { ONSITE: 'ที่บริษัท', ONLINE: 'ออนไลน์', HYBRID: 'ที่บริษัท + ออนไลน์' };

const OFFSET = '+07:00';
const BKK_MS = 7 * 3_600_000;

/** "2026-11-16" + "10:30" → ISO instant in Bangkok time. */
export const toInstant = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${OFFSET}`).toISOString();
/** Instant → Bangkok "HH:MM". */
export const bkkTime = (iso: string) => new Date(Date.parse(iso) + BKK_MS).toISOString().slice(11, 16);
/** Instant → Bangkok "YYYY-MM-DD". */
export const bkkDate = (iso: string) => new Date(Date.parse(iso) + BKK_MS).toISOString().slice(0, 10);
/** Minutes since Bangkok midnight. */
export const bkkMinutes = (iso: string) => {
  const t = bkkTime(iso);
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
};
export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Day window of the room board. */
export const BOARD_START = 8 * 60;
export const BOARD_END = 19 * 60;

export const ROOM_COLOR: Record<string, string> = {
  indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
};
export const roomColor = (c: string | null | undefined) => ROOM_COLOR[c ?? ''] ?? 'bg-brand-500';
