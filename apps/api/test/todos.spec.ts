import { INestApplication } from '@nestjs/common';
import { engagementId, login, prisma, Session, startApp } from './helpers';

let app: INestApplication;
let employee: Session, employee2: Session, outsider: Session, manager: Session;
let bookkeeping: string, closing: string, a002: string;
let today: string;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const post = (s: Session, path: string, body: object) => s.agent.post(`/api${path}`).set('X-CSRF-Token', s.csrf).send(body);
const patch = (s: Session, id: string, body: object) => s.agent.patch(`/api/todos/${id}`).set('X-CSRF-Token', s.csrf).send(body);
const del = (s: Session, id: string, version: number) => s.agent.delete(`/api/todos/${id}?version=${version}`).set('X-CSRF-Token', s.csrf);
const week = async (s: Session, date: string, employeeId?: string) =>
  (await s.agent.get('/api/todos/week').query({ date, ...(employeeId ? { employeeId } : {}) }).expect(200)).body;

beforeAll(async () => {
  app = await startApp();
  [employee, employee2, outsider, manager] = await Promise.all(['employee', 'employee2', 'outsider', 'manager'].map((u) => login(app, `${u}@pas.test`)));
  bookkeeping = await engagementId('A001', 1);
  closing = await engagementId('A001', 40);
  a002 = await engagementId('A002', 1);
  today = (await employee.agent.get('/api/todos/week').expect(200)).body.today;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('own plan (estimate)', () => {
  it('plans work with the timesheet rules for step and length; the board sums planned vs required', async () => {
    const res = await post(employee, '/todos', { engagementId: bookkeeping, workDate: today, plannedMinutes: 120, note: 'ปิดงวด', priority: 'HIGH' }).expect(201);
    expect(res.body.version).toBe(1);
    await post(employee, '/todos', { engagementId: bookkeeping, workDate: today, plannedMinutes: 45 }).expect(422); // not a 30-min step
    await post(employee, '/todos', { engagementId: bookkeeping, workDate: today, plannedMinutes: 600 }).expect(422); // > 9 h in one item
    await post(employee, '/todos', { engagementId: bookkeeping, workDate: addDays(today, 200), plannedMinutes: 60 }).expect(422); // too far ahead
    await post(employee, '/todos', { engagementId: bookkeeping, workDate: addDays(today, -40), plannedMinutes: 60 }).expect(422); // too far back

    const board = await week(employee, today);
    const item = board.items.find((i: { id: string }) => i.id === res.body.id);
    expect(item).toMatchObject({ plannedMinutes: 120, priority: 'HIGH', status: 'PLANNED', late: false, assignedBy: null, note: 'ปิดงวด' });
    expect(board.days.find((d: { date: string }) => d.date === today).plannedMinutes).toBeGreaterThanOrEqual(120);
    expect(board.canEdit).toBe(true);
  });

  it('marks past unfinished work as late (derived, no nightly job) and carries it over to today', async () => {
    const yesterday = addDays(today, -1);
    const old = (await post(employee, '/todos', { engagementId: closing, workDate: yesterday, plannedMinutes: 60 }).expect(201)).body;
    const done = (await post(employee, '/todos', { engagementId: a002, workDate: yesterday, plannedMinutes: 60 }).expect(201)).body;
    await patch(employee, done.id, { expectedVersion: done.version, status: 'DONE' }).expect(200);

    const before = await week(employee, yesterday);
    expect(before.items.find((i: { id: string }) => i.id === old.id).late).toBe(true);
    expect(before.items.find((i: { id: string }) => i.id === done.id).late).toBe(false);

    const moved = (await post(employee, '/todos/carry-over', { toDate: today }).expect(201)).body;
    expect(moved.moved).toBeGreaterThanOrEqual(1);
    const after = await week(employee, today);
    expect(after.items.find((i: { id: string }) => i.id === old.id)).toMatchObject({ workDate: today, late: false });
    await post(employee, '/todos/carry-over', { toDate: yesterday }).expect(422);
  });

  it('rejects a stale version (two tabs editing the same item)', async () => {
    const t = (await post(employee, '/todos', { engagementId: a002, workDate: today, plannedMinutes: 30 }).expect(201)).body;
    await patch(employee, t.id, { expectedVersion: 1, plannedMinutes: 60 }).expect(200);
    await patch(employee, t.id, { expectedVersion: 1, plannedMinutes: 90 }).expect(409);
  });
});

describe('team leads assign work', () => {
  it('a lead plans for people in their team only; employees cannot plan for colleagues', async () => {
    const assigned = (await post(manager, '/todos', { employeeId: employee.userId, engagementId: a002, workDate: today, plannedMinutes: 60 }).expect(201)).body;
    await post(manager, '/todos', { employeeId: outsider.userId, engagementId: a002, workDate: today, plannedMinutes: 60 }).expect(403);
    await post(employee, '/todos', { employeeId: employee2.userId, engagementId: a002, workDate: today, plannedMinutes: 60 }).expect(403);

    const board = await week(employee, today);
    expect(board.items.find((i: { id: string }) => i.id === assigned.id).assignedBy.id).toBe(manager.userId);
    expect((await week(manager, today, employee.userId)).canEdit).toBe(true);
    await employee.agent.get('/api/todos/week').query({ employeeId: employee2.userId }).expect(403);
  });

  it('the assignee cancels (not deletes) lead-assigned work; the lead can delete it', async () => {
    const t = (await post(manager, '/todos', { employeeId: employee.userId, engagementId: bookkeeping, workDate: today, plannedMinutes: 30 }).expect(201)).body;
    const res = await del(employee, t.id, t.version).expect(403);
    expect(res.body.code).toBe('ASSIGNED_BY_LEAD');
    const cancelled = (await patch(employee, t.id, { expectedVersion: t.version, status: 'CANCELLED' }).expect(200)).body;
    await del(manager, t.id, cancelled.version).expect(204);
  });

  it('team overview shows planned vs actual per person; employees cannot open it', async () => {
    const team = (await manager.agent.get('/api/todos/team').query({ date: today }).expect(200)).body;
    const me = team.people.find((p: { employee: { id: string } }) => p.employee.id === employee.userId);
    expect(me.days.find((d: { date: string }) => d.date === today).plannedMinutes).toBeGreaterThan(0);
    expect(team.people.some((p: { employee: { id: string } }) => p.employee.id === outsider.userId)).toBe(false);
    await employee.agent.get('/api/todos/team').expect(403);
  });
});

describe('custom items (free text, not an Activity)', () => {
  it('are personal notes: not counted in planned hours, cost or the team view', async () => {
    const dayBefore = (await week(employee, today)).days.find((d: { date: string }) => d.date === today).plannedMinutes;
    const costBefore = (await week(manager, today, employee.userId)).cost.planned;
    const teamBefore = (await manager.agent.get('/api/todos/team').query({ date: today }).expect(200)).body.people.find((p: { employee: { id: string } }) => p.employee.id === employee.userId);

    const note = (await post(employee, '/todos', { title: 'โทรตามเอกสารลูกค้า', workDate: today }).expect(201)).body;
    await post(employee, '/todos', { title: 'อบรมภายใน', workDate: today, plannedMinutes: 120 }).expect(201); // hours are optional but allowed
    await post(employee, '/todos', { title: 'x', workDate: today, plannedMinutes: 45 }).expect(422); // same step rule when hours are given
    await post(employee, '/todos', { title: 'x', engagementId: a002, workDate: today, plannedMinutes: 60 }).expect(400); // one kind only
    await post(employee, '/todos', { workDate: today }).expect(400);
    await post(employee, '/todos', { engagementId: a002, workDate: today }).expect(400); // a task needs an estimate

    const board = await week(employee, today);
    const item = board.items.find((i: { id: string }) => i.id === note.id);
    expect(item).toMatchObject({ kind: 'CUSTOM', task: null, title: 'โทรตามเอกสารลูกค้า', plannedMinutes: null, actualMinutes: 0 });
    expect(board.days.find((d: { date: string }) => d.date === today).plannedMinutes).toBe(dayBefore);
    expect((await week(manager, today, employee.userId)).cost.planned).toBe(costBefore);
    const teamAfter = (await manager.agent.get('/api/todos/team').query({ date: today }).expect(200)).body.people.find((p: { employee: { id: string } }) => p.employee.id === employee.userId);
    expect(teamAfter.days).toEqual(teamBefore.days);
  });

  it('are private to the assignee and whoever wrote them', async () => {
    const mine = (await post(employee, '/todos', { title: 'เรื่องส่วนตัว', workDate: today }).expect(201)).body;
    const leadsBoard = await week(manager, today, employee.userId);
    expect(leadsBoard.items.some((i: { id: string }) => i.id === mine.id)).toBe(false);
    await patch(manager, mine.id, { expectedVersion: mine.version, status: 'DONE' }).expect(404);

    const fromLead = (await post(manager, '/todos', { employeeId: employee.userId, title: 'เตรียมเอกสารประชุมทีม', workDate: today }).expect(201)).body;
    expect((await week(manager, today, employee.userId)).items.some((i: { id: string }) => i.id === fromLead.id)).toBe(true);
    const seen = (await week(employee, today)).items.find((i: { id: string }) => i.id === fromLead.id);
    expect(seen.assignedBy.id).toBe(manager.userId);

    const renamed = (await patch(employee, mine.id, { expectedVersion: mine.version, title: 'เรื่องส่วนตัว (แก้ชื่อ)', plannedMinutes: 30 }).expect(200)).body;
    await patch(employee, mine.id, { expectedVersion: renamed.version, plannedMinutes: null }).expect(200); // custom: hours can be cleared
  });
});

describe('estimate vs actual', () => {
  it('shows the actual minutes logged for the same task and day; cost only for cost.read', async () => {
    await employee.agent
      .put('/api/time-report/entries')
      .set('X-CSRF-Token', employee.csrf)
      .send({ engagementId: bookkeeping, workDate: today, durationMinutes: 90 })
      .expect(200);
    const board = await week(employee, today);
    const planned = board.items.find((i: { task: { engagementId: string }; workDate: string }) => i.task.engagementId === bookkeeping && i.workDate === today);
    expect(planned.actualMinutes).toBe(90);
    expect(board.cost).toBeNull();

    const seenByLead = await week(manager, today, employee.userId);
    expect(seenByLead.cost).not.toBeNull();
    expect(typeof seenByLead.cost.planned).toBe('number');
  });

  it('fill from plan creates missing cells, never overwrites existing ones, and reports rule violations per cell', async () => {
    const yesterday = addDays(today, -1);
    const res = await post(employee2, '/time-report/fill-from-plan', {
      items: [
        { engagementId: a002, workDate: yesterday, durationMinutes: 60, description: 'จากแผน' },
        { engagementId: closing, workDate: yesterday, durationMinutes: 45 }, // not a 30-min step
      ],
    }).expect(201);
    expect(res.body.results.map((r: { result: string }) => r.result)).toEqual(['CREATED', 'REJECTED']);

    const again = await post(employee2, '/time-report/fill-from-plan', { items: [{ engagementId: a002, workDate: yesterday, durationMinutes: 120 }] }).expect(201);
    expect(again.body.results[0].result).toBe('SKIPPED_EXISTS');
    const entry = await prisma.timeEntry.findFirstOrThrow({ where: { employeeId: employee2.userId, engagementId: a002, workDate: new Date(`${yesterday}T00:00:00Z`), deletedAt: null } });
    expect(entry.durationMinutes).toBe(60); // untouched
  });
});
