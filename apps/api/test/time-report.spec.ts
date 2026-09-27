import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { engagementId, login, prisma, Session, startApp } from './helpers';

let app: INestApplication;
let employee: Session, employee2: Session, outsider: Session, manager: Session, partner: Session, admin: Session, itUser: Session;
let a001Bookkeeping: string, a001Closing: string, a002Bookkeeping: string;

beforeAll(async () => {
  app = await startApp();
  [employee, employee2, outsider, manager, partner, admin, itUser] = await Promise.all(
    ['employee', 'employee2', 'outsider', 'manager', 'partner', 'admin', 'it'].map((u) => login(app, `${u}@pas.test`)),
  );
  a001Bookkeeping = await engagementId('A001', 1);
  a001Closing = await engagementId('A001', 40);
  a002Bookkeeping = await engagementId('A002', 1);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const put = (s: Session, body: object) => s.agent.put('/api/time-report/entries').set('X-CSRF-Token', s.csrf).send(body);

describe('authentication & CSRF', () => {
  it('health is public', () => request(app.getHttpServer()).get('/api/health').expect(200));

  it('rejects unauthenticated reads and writes (legacy query_db.php was open)', async () => {
    const anon = request(app.getHttpServer());
    await anon.get('/api/time-report/week?date=2026-09-02').expect(401);
    await anon.put('/api/time-report/entries').send({}).expect(401);
    await anon.get('/api/employees').expect(401);
    await anon.get('/api/reports/timesheet/export?month=2026-09').expect(401);
  });

  it('rejects a forged session cookie', () =>
    request(app.getHttpServer()).get('/api/auth/me').set('Cookie', 'pas_sid=forged-token').expect(401));

  it('rejects writes without a matching CSRF token', async () => {
    const body = { engagementId: a001Bookkeeping, workDate: '2026-09-01', durationMinutes: 60 };
    const res = await employee.agent.put('/api/time-report/entries').send(body).expect(403);
    expect(res.body.code).toBe('CSRF_INVALID');
    await employee.agent.put('/api/time-report/entries').set('X-CSRF-Token', manager.csrf).send(body).expect(403);
  });

  it('dev login refuses unknown users', () =>
    request(app.getHttpServer()).post('/api/auth/dev-login').send({ email: 'nobody@pas.test' }).expect(401));

  it('logout revokes the session server-side', async () => {
    const s = await login(app, 'employee@pas.test');
    await s.agent.post('/api/auth/logout').set('X-CSRF-Token', s.csrf).expect(204);
    await s.agent.get('/api/auth/me').expect(401);
  });

  it('sets hardened security headers and a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('time entry lifecycle', () => {
  let entry: { id: string; version: number };

  it('creates an entry and audits it', async () => {
    const res = await put(employee, { engagementId: a001Bookkeeping, workDate: '2026-09-02', durationMinutes: 240, description: 'บันทึกบัญชี' }).expect(200);
    entry = res.body;
    expect(res.body).toMatchObject({ durationMinutes: 240, version: 1, status: 'DRAFT' });
    const audit = await prisma.auditEvent.findFirst({ where: { resourceId: entry.id, action: 'time_entry.create' } });
    expect(audit?.actorId).toBe(employee.userId);
  });

  it('identical retry is idempotent (no duplicate rows — legacy had 765 duplicate groups)', async () => {
    const res = await put(employee, { engagementId: a001Bookkeeping, workDate: '2026-09-02', durationMinutes: 240, description: 'บันทึกบัญชี' }).expect(200);
    expect(res.body.id).toBe(entry.id);
    expect(await prisma.timeEntry.count({ where: { employeeId: employee.userId, workDate: new Date('2026-09-02T00:00:00Z'), deletedAt: null } })).toBe(1);
  });

  it('requires the current version to change an existing cell', async () => {
    const change = { engagementId: a001Bookkeeping, workDate: '2026-09-02', durationMinutes: 300 };
    expect((await put(employee, change).expect(409)).body.code).toBe('VERSION_CONFLICT');
    expect((await put(employee, { ...change, expectedVersion: 7 }).expect(409)).body.code).toBe('VERSION_CONFLICT');
    const res = await put(employee, { ...change, expectedVersion: 1 }).expect(200);
    expect(res.body.version).toBe(2);
    entry = res.body;
  });

  it('week view returns grid, day status and totals in one request', async () => {
    await put(employee, { engagementId: a001Closing, workDate: '2026-09-02', durationMinutes: 240 }).expect(200);
    const res = await employee.agent.get('/api/time-report/week?date=2026-09-03').expect(200);
    expect(res.body).toMatchObject({ weekStart: '2026-08-31', weekEnd: '2026-09-06', editable: true });
    expect(res.body.days).toHaveLength(7);
    const day = res.body.days.find((d: { date: string }) => d.date === '2026-09-02');
    expect(day).toMatchObject({ totalMinutes: 540, requiredMinutes: 540, status: 'COMPLETE' });
    expect(res.body.days.find((d: { date: string }) => d.date === '2026-09-05')).toMatchObject({ weekend: true, requiredMinutes: 0, status: 'OFF' });
    expect(res.body.rows.filter((r: { carried: boolean }) => !r.carried)).toHaveLength(2);
    expect(res.body.totals).toEqual({ recordedMinutes: 540, requiredMinutes: 5 * 540 });
  });

  it('carries last week’s tasks into the next week as empty rows, and lists recent tasks', async () => {
    const res = await employee.agent.get('/api/time-report/week?date=2026-09-09').expect(200);
    const carried = res.body.rows.filter((r: { carried: boolean }) => r.carried);
    expect(carried.map((r: { engagementId: string }) => r.engagementId).sort()).toEqual([a001Bookkeeping, a001Closing].sort());
    expect(carried.every((r: { totalMinutes: number }) => r.totalMinutes === 0)).toBe(true);
    expect(res.body.recentEngagements.map((e: { engagementId: string }) => e.engagementId)).toEqual(expect.arrayContaining([a001Bookkeeping, a001Closing]));
  });

  it('month summary gives per-day totals and due-day completeness', async () => {
    const res = await employee.agent.get('/api/time-report/month-summary?month=2026-09').expect(200);
    expect(res.body.days).toHaveLength(30);
    expect(res.body.days.find((d: { date: string }) => d.date === '2026-09-02').totalMinutes).toBe(540);
    expect(res.body.totals.completeDueDays).toBeGreaterThanOrEqual(1);
    expect(res.body.totals.dueDays).toBeGreaterThanOrEqual(res.body.totals.completeDueDays);
  });

  it('holiday reduces the required minutes for that day', async () => {
    const res = await employee.agent.get('/api/time-report/week?date=2026-10-13').expect(200);
    expect(res.body.days.find((d: { date: string }) => d.date === '2026-10-13')).toMatchObject({ requiredMinutes: 0, status: 'OFF' });
    expect(res.body.totals.requiredMinutes).toBe(4 * 540);
  });

  it('soft-deletes with version check, audits, and allows re-entry', async () => {
    await employee.agent.delete(`/api/time-report/entries/${entry.id}?version=1`).set('X-CSRF-Token', employee.csrf).expect(409);
    await employee.agent.delete(`/api/time-report/entries/${entry.id}?version=${entry.version}`).set('X-CSRF-Token', employee.csrf).expect(204);
    const row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { resourceId: entry.id, action: 'time_entry.delete' } })).toBe(1);
    await put(employee, { engagementId: a001Bookkeeping, workDate: '2026-09-02', durationMinutes: 300 }).expect(200);
  });
});

describe('server-side validation (legacy validated only in the browser)', () => {
  const base = () => ({ engagementId: a002Bookkeeping, workDate: '2026-09-03' });

  it.each([
    [45, 'DURATION_INCREMENT'],
    [570, 'DURATION_TOO_LONG'],
    [0, 'DURATION_INVALID'],
    [-90, 'DURATION_INVALID'],
  ])('rejects %p minutes with %s', async (durationMinutes, code) => {
    const res = await put(employee, { ...base(), durationMinutes }).expect(422);
    expect(res.body.code).toBe(code);
  });

  it('rejects malformed input and unknown fields', async () => {
    await put(employee, { ...base(), durationMinutes: 60, workDate: '2026-02-30' }).expect(400);
    await put(employee, { ...base(), durationMinutes: 60, employeeId: outsider.userId }).expect(400);
    await put(employee, { ...base(), durationMinutes: '60; DROP TABLE time_entry' }).expect(400);
    await employee.agent.get("/api/time-report/week?date=2026-09-01&employeeId=' OR 1=1 --").expect(400);
    await employee.agent.get('/api/time-report/week?date=2026-13-01').expect(400);
  });

  it('rejects entries too far in the future', async () => {
    expect((await put(employee, { ...base(), workDate: '2027-06-01', durationMinutes: 60 }).expect(422)).body.code).toBe('FUTURE_LIMIT');
  });

  it('rejects closed engagements', async () => {
    const wc = await prisma.workCategory.findUniqueOrThrow({ where: { legacyId: 41 } });
    const a002 = await prisma.customer.findUniqueOrThrow({ where: { code: 'A002' } });
    const closed = await prisma.engagement.create({ data: { customerId: a002.id, workCategoryId: wc.id, isActive: false } });
    expect((await put(employee, { engagementId: closed.id, workDate: '2026-09-03', durationMinutes: 60 }).expect(422)).body.code).toBe('ENGAGEMENT_INACTIVE');
  });

  it('enforces maxDailyMinutes once configured by an admin', async () => {
    const policy = await admin.agent.get('/api/calendar/policy').expect(200);
    await admin.agent.put('/api/calendar/policy').set('X-CSRF-Token', admin.csrf).send({ ...policy.body, maxDailyMinutes: 600 }).expect(200);
    await put(employee2, { engagementId: a001Bookkeeping, workDate: '2026-09-04', durationMinutes: 540 }).expect(200);
    expect((await put(employee2, { engagementId: a001Closing, workDate: '2026-09-04', durationMinutes: 120 }).expect(422)).body.code).toBe('DAILY_LIMIT');
    await admin.agent.put('/api/calendar/policy').set('X-CSRF-Token', admin.csrf).send({ ...policy.body, maxDailyMinutes: null }).expect(200);
  });
});

describe('period lock', () => {
  it('only calendar admins can lock; locked months reject writes and deletes', async () => {
    const created = await put(employee, { engagementId: a001Bookkeeping, workDate: '2026-08-10', durationMinutes: 60 }).expect(200);
    await employee.agent.put('/api/calendar/locks/2026-08').set('X-CSRF-Token', employee.csrf).send({}).expect(403);
    await admin.agent.put('/api/calendar/locks/2026-08').set('X-CSRF-Token', admin.csrf).send({ reason: 'ปิดงวด' }).expect(200);

    expect((await put(employee, { engagementId: a001Bookkeeping, workDate: '2026-08-11', durationMinutes: 60 }).expect(422)).body.code).toBe('PERIOD_LOCKED');
    await employee.agent.delete(`/api/time-report/entries/${created.body.id}?version=1`).set('X-CSRF-Token', employee.csrf).expect(422);
    const view = await employee.agent.get('/api/time-report/week?date=2026-08-12').expect(200);
    expect(view.body.editable).toBe(false);
    expect(view.body.days.every((d: { locked: boolean }) => d.locked)).toBe(true);
    // A week spanning two months: only the locked month's days are locked.
    const span = await employee.agent.get('/api/time-report/week?date=2026-09-01').expect(200);
    expect(span.body.days.map((d: { locked: boolean }) => d.locked)).toEqual([true, false, false, false, false, false, false]);
    expect(span.body.editable).toBe(true);

    await admin.agent.delete('/api/calendar/locks/2026-08').set('X-CSRF-Token', admin.csrf).expect(204);
    await put(employee, { engagementId: a001Bookkeeping, workDate: '2026-08-11', durationMinutes: 60 }).expect(200);
  });
});

describe('authorization & data scoping', () => {
  it("employees cannot read or change other people's time", async () => {
    await employee.agent.get(`/api/time-report/week?date=2026-09-02&employeeId=${employee2.userId}`).expect(403);
    const other = await prisma.timeEntry.findFirstOrThrow({ where: { employeeId: employee2.userId, deletedAt: null } });
    await employee.agent.delete(`/api/time-report/entries/${other.id}?version=${other.version}`).set('X-CSRF-Token', employee.csrf).expect(403);
  });

  it('employees cannot open reports or exports', async () => {
    await employee.agent.get('/api/reports/timesheet?month=2026-09').expect(403);
    await employee.agent.get('/api/reports/timesheet/export?month=2026-09').expect(403);
  });

  it('managers see only the org units they manage (legacy: everyone)', async () => {
    await manager.agent.get(`/api/time-report/week?date=2026-09-02&employeeId=${employee.userId}`).expect(200);
    await manager.agent.get(`/api/time-report/week?date=2026-09-02&employeeId=${outsider.userId}`).expect(403);
    const res = await manager.agent.get('/api/reports/timesheet?month=2026-09').expect(200);
    const ids = res.body.employees.map((e: { id: string }) => e.id);
    expect(ids).toEqual(expect.arrayContaining([employee.userId, employee2.userId, manager.userId]));
    expect(ids).not.toContain(outsider.userId);
    expect(ids).not.toContain(partner.userId);
  });

  it('manager view of a team member is read-only', async () => {
    const res = await manager.agent.get(`/api/time-report/week?date=2026-09-02&employeeId=${employee.userId}`).expect(200);
    expect(res.body.editable).toBe(false);
  });

  it('partners see the whole company', async () => {
    const res = await partner.agent.get('/api/reports/timesheet?month=2026-09').expect(200);
    expect(res.body.employees.map((e: { id: string }) => e.id)).toContain(outsider.userId);
  });

  it('IT manages accounts but cannot see time reports (legacy IT saw rates and costs)', async () => {
    await itUser.agent.get('/api/reports/timesheet?month=2026-09').expect(403);
    await itUser.agent.get(`/api/time-report/week?date=2026-09-02&employeeId=${employee.userId}`).expect(403);
  });

  it('employee picker data never exposes other people’s e-mail or roles to non-admins', async () => {
    const res = await manager.agent.get('/api/employees').expect(200);
    expect(res.body[0]).not.toHaveProperty('email');
    expect(res.body[0]).not.toHaveProperty('roles');
  });

  it('task search matches every token across customer code, name and task', async () => {
    const res = await employee.agent.get('/api/catalog/engagements/search?q=A001 ปิดบัญชี').expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((e: { customer: { code: string }; workCategory: { name: string } }) => e.customer.code === 'A001' && e.workCategory.name.includes('ปิดบัญชี'))).toBe(true);
    expect(res.body[0]).not.toHaveProperty('taxId');
    await employee.agent.get(`/api/catalog/engagements/search?q=${'x'.repeat(101)}`).expect(400);
  });

  it('non-admins get customer pickers without tax id / address', async () => {
    const res = await employee.agent.get('/api/catalog/customers').expect(200);
    expect(res.body[0]).not.toHaveProperty('taxId');
    await employee.agent.post('/api/catalog/customers').set('X-CSRF-Token', employee.csrf).send({ code: 'X1', name: 'x' }).expect(403);
  });
});

describe('employee administration', () => {
  it('blocks self-escalation and IT granting ADMIN', async () => {
    await admin.agent.patch(`/api/employees/${admin.userId}`).set('X-CSRF-Token', admin.csrf).send({ roles: ['EMPLOYEE'] }).expect(403);
    await itUser.agent.patch(`/api/employees/${employee2.userId}`).set("X-CSRF-Token", itUser.csrf).send({ roles: ['EMPLOYEE', 'ADMIN'] }).expect(403);
  });

  it('deactivating an employee kills their live sessions immediately', async () => {
    const victim = await login(app, 'outsider@pas.test');
    await victim.agent.get('/api/auth/me').expect(200);
    await admin.agent.patch(`/api/employees/${victim.userId}`).set('X-CSRF-Token', admin.csrf).send({ status: 'INACTIVE' }).expect(200);
    await victim.agent.get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).post('/api/auth/dev-login').send({ email: 'outsider@pas.test' }).expect(401);
    await admin.agent.patch(`/api/employees/${victim.userId}`).set('X-CSRF-Token', admin.csrf).send({ status: 'ACTIVE' }).expect(200);
  });
});

describe('reports & export', () => {
  it('exports xlsx for managers and audits the export', async () => {
    const res = await manager.agent.get('/api/reports/timesheet/export?month=2026-09').buffer(true).expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['cache-control']).toBe('no-store');
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'report.export', actorId: manager.userId } });
    expect(audit?.metadata).toMatchObject({ month: '2026-09' });
  });

  it('weekly completeness subtracts holidays once', async () => {
    const res = await partner.agent.get('/api/time-report/completeness?weekOf=2026-10-14').expect(200);
    expect(res.body).toMatchObject({ weekStart: '2026-10-12', weekEnd: '2026-10-16', requiredMinutes: 4 * 540 });
  });

  it('customer effort aggregates hours by level without costs', async () => {
    const res = await partner.agent.get('/api/reports/customer-effort?from=2026-09-01&to=2026-09-30').expect(200);
    const a001 = res.body.customers.find((c: { code: string }) => c.code === 'A001');
    expect(a001.totalMinutes).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/rate|cost/i);
  });
});

describe('audit trail', () => {
  it('is append-only at the database level', async () => {
    const row = await prisma.auditEvent.findFirstOrThrow();
    await expect(prisma.auditEvent.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it('never stores secrets in audit payloads', async () => {
    const rows = await prisma.auditEvent.findMany();
    expect(JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(employee.csrf);
  });
});

describe('brute-force protection (runs last: exhausts the login budget)', () => {
  it('rate-limits login attempts per client', async () => {
    const anon = request(app.getHttpServer());
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) statuses.push((await anon.post('/api/auth/dev-login').send({ email: `guess${i}@pas.test` })).status);
    expect(statuses).toContain(401);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('a random cookie per attempt does not reset the login limit', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/dev-login')
      .set('Cookie', `pas_sid=random-${Date.now()}`)
      .send({ email: 'guess@pas.test' });
    expect(res.status).toBe(429);
  });
});
