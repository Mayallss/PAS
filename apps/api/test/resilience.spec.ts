import { INestApplication } from '@nestjs/common';
import { LeaveService } from '../src/modules/leave/leave.service';
import { MeetingsService } from '../src/modules/meetings/meetings.service';
import { login, prisma, Session, startApp } from './helpers';

/** "What is unavailable is just missing — the system must not break" (user, 2026-10-02). */
let app: INestApplication;
let employee: Session;
let admin: Session;

beforeAll(async () => {
  app = await startApp();
  [employee, admin] = await Promise.all([login(app, 'employee@pas.test'), login(app, 'admin@pas.test')]);
});

afterAll(async () => {
  jest.restoreAllMocks();
  await app.close();
  await prisma.$disconnect();
});

it('one failing module leaves its part out of the bell and home page; the rest still works', async () => {
  jest.spyOn(app.get(LeaveService), 'attentionCount').mockRejectedValue(new Error('leave module down'));
  jest.spyOn(app.get(MeetingsService), 'attention').mockRejectedValue(new Error('meetings module down'));
  const bell = await employee.agent.get('/api/notifications').expect(200);
  expect(Array.isArray(bell.body.items)).toBe(true);
  const home = await employee.agent.get('/api/home').expect(200);
  expect(home.body.profile.fullName).toBe('สมชาย ทดสอบ');
  expect(home.body.week.days.length).toBe(7);
  jest.restoreAllMocks();
});

it('reports integrations for everyone (what is missing while off); setting details only for admins', async () => {
  const forEmployee = await employee.agent.get('/api/integrations').expect(200);
  const keys = forEmployee.body.items.map((i: { key: string }) => i.key);
  expect(keys).toEqual(['google_login', 'google_calendar', 'monday', 'trcloud']);
  for (const i of forEmployee.body.items) {
    expect(['ON', 'OFF', 'ERROR']).toContain(i.state);
    expect(i.whenOff).toBeTruthy();
    expect(i.issues).toBeUndefined();
  }
  expect(forEmployee.body.items.find((i: { key: string }) => i.key === 'google_login').state).toBe('OFF'); // tests run without SSO
  const forAdmin = await admin.agent.get('/api/integrations').expect(200);
  expect(forAdmin.body.items.find((i: { key: string }) => i.key === 'google_calendar')).toHaveProperty('issues');
});

it('booking a room and filing leave do not need Google at all', async () => {
  const rooms = (await employee.agent.get('/api/rooms').expect(200)).body;
  const day = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
  await employee.agent
    .post('/api/rooms/bookings')
    .set('X-CSRF-Token', employee.csrf)
    .send({ title: 'ไม่มี Google ก็จองได้', mode: 'ONSITE', roomId: rooms[0].id, startsAt: `${day}T16:00:00+07:00`, endsAt: `${day}T16:30:00+07:00` })
    .expect(201);
});
