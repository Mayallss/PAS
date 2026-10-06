import { INestApplication } from '@nestjs/common';
import { createVerify } from 'crypto';
import { CalendarSyncService } from '../src/modules/calendar-sync/calendar-sync.service';
import { GoogleCalendarClient } from '../src/modules/calendar-sync/google-calendar.client';
import { login, prisma, Session, startApp } from './helpers';

/** Meeting rooms + bookings, and the Google Calendar mirror against a FAKE Google (docs/09). */
let app: INestApplication;
let employee: Session;
let employee2: Session;
let admin: Session;
let rooms: { id: string; name: string }[];

const post = (s: Session, url: string, body: object) => s.agent.post(url).set('X-CSRF-Token', s.csrf).send(body);
const patch = (s: Session, url: string, body: object) => s.agent.patch(url).set('X-CSRF-Token', s.csrf).send(body);
/** Tomorrow-ish at HH:MM Bangkok time, `days` ahead. */
const at = (days: number, hhmm: string) => {
  const d = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  return `${d}T${hhmm}:00+07:00`;
};

beforeAll(async () => {
  app = await startApp();
  [employee, employee2, admin] = await Promise.all(['employee@pas.test', 'employee2@pas.test', 'admin@pas.test'].map((e) => login(app, e)));
  rooms = (await employee.agent.get('/api/rooms').expect(200)).body;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('booking a room', () => {
  let bookingId: string;
  const big = () => rooms.find((r) => r.name === 'ห้องประชุมใหญ่')!.id;

  it('books a room with colleagues and a guest', async () => {
    const res = await post(employee, '/api/rooms/bookings', {
      title: 'ประชุมปิดงบ A001',
      mode: 'ONSITE',
      roomId: big(),
      startsAt: at(3, '10:00'),
      endsAt: at(3, '11:00'),
      attendeeIds: [employee2.userId],
      guestEmails: ['Owner@Customer.co.th'],
    }).expect(201);
    expect(res.body).toMatchObject({ status: 'CONFIRMED', room: { name: 'ห้องประชุมใหญ่' }, canEdit: true });
    expect(res.body.attendees).toEqual(expect.arrayContaining([{ email: 'owner@customer.co.th' }, expect.objectContaining({ employeeId: employee2.userId })]));
    bookingId = res.body.id;
  });

  it('refuses a double booking, but back-to-back is fine', async () => {
    const clash = await post(employee2, '/api/rooms/bookings', { title: 'ซ้อน', mode: 'HYBRID', roomId: big(), startsAt: at(3, '10:30'), endsAt: at(3, '11:30') }).expect(409);
    expect(clash.body).toMatchObject({ code: 'ROOM_TAKEN', conflict: { title: 'ประชุมปิดงบ A001' } });
    await post(employee2, '/api/rooms/bookings', { title: 'ต่อกัน', mode: 'ONSITE', roomId: big(), startsAt: at(3, '11:00'), endsAt: at(3, '12:00') }).expect(201);
  });

  it('validates time, room and mode', async () => {
    await post(employee, '/api/rooms/bookings', { title: 'อดีต', mode: 'ONLINE', startsAt: at(-1, '10:00'), endsAt: at(-1, '11:00') }).expect(422);
    await post(employee, '/api/rooms/bookings', { title: 'เวลาแปลก', mode: 'ONLINE', startsAt: at(3, '10:03'), endsAt: at(3, '11:00') }).expect(400);
    await post(employee, '/api/rooms/bookings', { title: 'ยาวไป', mode: 'ONLINE', startsAt: at(3, '06:00'), endsAt: at(3, '19:00') }).expect(422);
    await post(employee, '/api/rooms/bookings', { title: 'ไม่มีห้อง', mode: 'ONSITE', startsAt: at(3, '14:00'), endsAt: at(3, '15:00') }).expect(400);
    await post(employee, '/api/rooms/bookings', { title: 'ลิงก์ไม่ปลอดภัย', mode: 'ONLINE', meetingUrl: 'http://zoom.us/x', startsAt: at(3, '14:00'), endsAt: at(3, '15:00') }).expect(400);
    const online = await post(employee, '/api/rooms/bookings', { title: 'คุยกับลูกค้า', mode: 'ONLINE', roomId: big(), startsAt: at(3, '10:00'), endsAt: at(3, '10:30') }).expect(201);
    expect(online.body.room).toBeNull(); // online never takes a room
  });

  it('only the organizer (or room.manage) edits / cancels; versions guard lost updates', async () => {
    const base = { title: 'ประชุมปิดงบ A001 (เลื่อน)', mode: 'ONSITE', roomId: big(), startsAt: at(4, '10:00'), endsAt: at(4, '11:00'), attendeeIds: [employee2.userId] };
    await patch(employee2, `/api/rooms/bookings/${bookingId}`, { ...base, expectedVersion: 1 }).expect(403);
    const moved = await patch(employee, `/api/rooms/bookings/${bookingId}`, { ...base, expectedVersion: 1 }).expect(200);
    expect(moved.body).toMatchObject({ version: 2, startsAt: new Date(at(4, '10:00')).toISOString() });
    await patch(employee, `/api/rooms/bookings/${bookingId}`, { ...base, expectedVersion: 1 }).expect(409);
    // The old slot is free again.
    await post(employee2, '/api/rooms/bookings', { title: 'ช่องว่าง', mode: 'ONSITE', roomId: big(), startsAt: at(3, '10:00'), endsAt: at(3, '10:30') }).expect(201);
  });

  it('lists the day for everyone and "mine" for organizer and invitees', async () => {
    const day = await employee2.agent.get(`/api/rooms/bookings?from=${encodeURIComponent(at(4, '00:00'))}&to=${encodeURIComponent(at(5, '00:00'))}`).expect(200);
    expect(day.body.map((b: { id: string }) => b.id)).toContain(bookingId);
    const mine = await employee2.agent.get('/api/rooms/bookings/mine').expect(200);
    expect(mine.body.find((b: { id: string }) => b.id === bookingId)).toMatchObject({ canEdit: false });
  });

  it('rooms are managed with room.manage', async () => {
    await post(employee, '/api/rooms', { name: 'ห้องใหม่' }).expect(403);
    const room = await post(admin, '/api/rooms', { name: 'ห้องอบรม', capacity: 20, location: 'ชั้น 3', googleResourceEmail: 'c_abc123@resource.calendar.google.com' }).expect(201);
    expect(room.body).toMatchObject({ name: 'ห้องอบรม', capacity: 20 });
    await post(admin, '/api/rooms', { name: 'ห้องอบรม' }).expect(409);
  });
});

describe('Google Calendar mirror (fake Google)', () => {
  type Call = { method: string; path: string; subject: string; body: Record<string, unknown> | null };
  let calls: Call[];
  let failWith: number | null;
  let sync: CalendarSyncService;

  /** Verifies the signed assertion like Google does, then answers calendar calls in memory. */
  const fakeGoogle = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(String(init!.body)).get('assertion')!;
      const [h, c, sig] = assertion.split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(process.env.GOOGLE_TEST_PUBLIC_KEY!, Buffer.from(sig, 'base64url'));
      if (!ok) return json(400, { error: 'invalid_grant' });
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      return json(200, { access_token: `tok:${claims.sub}`, expires_in: 3600 });
    }
    const subject = String((init!.headers as Record<string, string>).Authorization).replace('Bearer tok:', '');
    const path = new URL(url).pathname.replace('/calendar/v3', '');
    const body = init!.body ? JSON.parse(String(init!.body)) : null;
    calls.push({ method: init!.method!, path, subject, body });
    if (failWith) return json(failWith, { error: { message: `fake ${failWith}` } });
    if (init!.method === 'DELETE') return json(204, null);
    const id = path.split('/events/')[1] ?? `evt${calls.length}`;
    return json(200, { id, ...(body?.conferenceData ? { hangoutLink: 'https://meet.google.com/abc-defg-hij' } : {}) });
  }) as typeof fetch;

  beforeAll(() => {
    sync = app.get(CalendarSyncService);
    const client = new GoogleCalendarClient(process.env.GOOGLE_SA_EMAIL!, process.env.GOOGLE_SA_PRIVATE_KEY!, fakeGoogle);
    jest.spyOn(sync, 'client').mockReturnValue(client);
  });

  beforeEach(() => {
    calls = [];
    failWith = null;
  });

  it('creates the event on the organizer’s calendar with invitees, the room and the company calendar; online gets Meet', async () => {
    const trainingRoom = (await admin.agent.get('/api/rooms?all=1').expect(200)).body.find((r: { name: string }) => r.name === 'ห้องอบรม');
    const b = await post(employee, '/api/rooms/bookings', {
      title: 'อบรมภาษีใหม่', mode: 'HYBRID', roomId: trainingRoom.id, startsAt: at(5, '13:00'), endsAt: at(5, '15:00'), attendeeIds: [employee2.userId], guestEmails: ['guest@client.com'],
    }).expect(201);
    const result = await sync.process();
    expect(result.configured).toBe(true);

    const insert = calls.find((c) => c.method === 'POST' && c.body?.summary === 'อบรมภาษีใหม่')!;
    expect(insert.subject).toBe('employee@pas.test');
    expect(insert.path).toBe('/calendars/primary/events');
    expect(insert.body!.attendees).toEqual(
      expect.arrayContaining([
        { email: 'employee2@pas.test' },
        { email: 'guest@client.com' },
        { email: 'c_abc123@resource.calendar.google.com', resource: true },
        { email: 'company@group.calendar.google.com', optional: true },
      ]),
    );
    expect(insert.body!.conferenceData).toBeDefined();
    expect(insert.body!.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 30 }] });
    const after = (await employee.agent.get(`/api/rooms/bookings/${b.body.id}`).expect(200)).body;
    expect(after).toMatchObject({ meetingUrl: 'https://meet.google.com/abc-defg-hij', calendar: { status: 'DONE' } });

    // Cancel → the event is deleted (attendees get the cancellation from Google).
    calls = [];
    await post(employee, `/api/rooms/bookings/${b.body.id}/cancel`, { reason: 'เลื่อน', expectedVersion: after.version }).expect(201);
    await sync.process();
    expect(calls).toEqual([expect.objectContaining({ method: 'DELETE', subject: 'employee@pas.test', path: expect.stringMatching(/^\/calendars\/primary\/events\/evt/) })]);
  });

  it('approved full-day leave becomes "out of office" without saying which leave', async () => {
    const vacation = await prisma.leaveType.findUniqueOrThrow({ where: { key: 'VACATION' } });
    const start = new Date(Date.now() + 40 * 86_400_000);
    while (start.getUTCDay() === 0 || start.getUTCDay() === 6) start.setUTCDate(start.getUTCDate() + 1);
    const day = start.toISOString().slice(0, 10);
    const hr = await login(app, 'hr@pas.test');
    await post(hr, '/api/leave/requests', { employeeId: employee2.userId, leaveTypeId: vacation.id, unit: 'DAYS', startDate: day, endDate: day, reason: 'ส่วนตัว', approve: true }).expect(201);
    await sync.process();
    const ooo = calls.find((c) => c.body?.eventType === 'outOfOffice')!;
    expect(ooo).toMatchObject({ method: 'POST', subject: 'employee2@pas.test', body: { summary: 'ลา (PAS)', start: { dateTime: `${day}T00:00:00` } } });
  });

  it('a Google failure is kept for retry with backoff, and reported in the status', async () => {
    const b = await post(employee, '/api/rooms/bookings', { title: 'ล้มเหลว', mode: 'ONLINE', startsAt: at(6, '09:00'), endsAt: at(6, '09:30') }).expect(201);
    failWith = 503;
    await sync.process();
    const row = await prisma.calendarSync.findUniqueOrThrow({ where: { kind_resourceId: { kind: 'room_booking', resourceId: b.body.id } } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'fake 503' });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    const status = await admin.agent.get('/api/rooms/calendar-sync').expect(200);
    expect(status.body).toMatchObject({ configured: true, companyCalendar: true });
    expect(status.body.failed).toBeGreaterThanOrEqual(1);
    await employee.agent.get('/api/rooms/calendar-sync').expect(403);
  });
});
