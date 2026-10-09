import { INestApplication } from '@nestjs/common';
import { login, prisma, Session, startApp } from './helpers';

let app: INestApplication;
let admin: Session, manager: Session, partner: Session, employee: Session;
let levels: Record<string, string>;
let personId: string;
let clientEngagement: string, leaveEngagement: string;
const customerCode = 'COST1';

const post = (s: Session, path: string, body: object) => s.agent.post(`/api${path}`).set('X-CSRF-Token', s.csrf).send(body);
const patch = (s: Session, path: string, body: object) => s.agent.patch(`/api${path}`).set('X-CSRF-Token', s.csrf).send(body);
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

beforeAll(async () => {
  app = await startApp();
  [admin, manager, partner, employee] = await Promise.all(['admin', 'manager', 'partner', 'employee'].map((u) => login(app, `${u}@pas.test`)));
  levels = Object.fromEntries((await prisma.employeeLevel.findMany()).map((l) => [l.code, l.id]));

  // A person in the manager's team (so the manager's scope includes them), Junior from 2026-01-01.
  const team = await prisma.orgUnit.findFirstOrThrow({ where: { name: 'ทีมบัญชี A' } });
  const person = await prisma.employee.create({ data: { fullName: 'ต้นทุน ทดสอบ', orgUnitId: team.id, startDate: d('2026-01-01') } });
  personId = person.id;
  await prisma.employeeLevelHistory.create({ data: { employeeId: personId, levelId: levels.J, effectiveFrom: d('2026-01-01') } });
  await prisma.employee.update({ where: { id: personId }, data: { levelId: levels.J } });

  const customer = await prisma.customer.create({ data: { code: customerCode, name: 'ลูกค้าคิดต้นทุน' } });
  const bookkeeping = await prisma.workCategory.findUniqueOrThrow({ where: { legacyId: 1 } });
  const sickLeave = await prisma.workCategory.findUniqueOrThrow({ where: { legacyId: 35 } });
  clientEngagement = (await prisma.engagement.create({ data: { customerId: customer.id, workCategoryId: bookkeeping.id } })).id;
  leaveEngagement = (await prisma.engagement.findFirstOrThrow({ where: { workCategoryId: sickLeave.id } })).id;

  const entry = (engagementId: string, date: string, minutes: number) => ({
    employeeId: personId, engagementId, workDate: d(date), durationMinutes: minutes, createdById: personId, updatedById: personId,
  });
  await prisma.timeEntry.createMany({
    data: [
      entry(clientEngagement, '2026-03-02', 480), // as Junior
      entry(clientEngagement, '2026-07-01', 540), // after promotion to Senior
      entry(leaveEngagement, '2026-07-02', 540), //  leave: reported apart from customers
    ],
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('who sees money', () => {
  it('Admin and Manager (cost.read); not Partner or employees; only Admin edits rates', async () => {
    await admin.agent.get('/api/cost-rates').expect(200);
    await manager.agent.get('/api/cost-rates').expect(200);
    await partner.agent.get('/api/cost-rates').expect(403);
    await employee.agent.get('/api/cost-rates').expect(403);
    await partner.agent.get('/api/reports/customer-cost?from=2026-01-01&to=2026-12-31').expect(403);
    await partner.agent.get('/api/reports/customer-effort?from=2026-01-01&to=2026-12-31').expect(200); // hours still visible
    await post(manager, '/cost-rates', { levelId: levels.J, amount: 1, unit: 'HOUR', effectiveFrom: '2026-01-01' }).expect(403);
  });
});

describe('rates are effective-dated', () => {
  it('a new rate closes the previous one; same date corrects; earlier date is refused', async () => {
    await post(admin, '/cost-rates', { levelId: levels.J, amount: 900, unit: 'HOUR', effectiveFrom: '2026-01-01' }).expect(201);
    await post(admin, '/cost-rates', { levelId: levels.J, amount: 1000, unit: 'HOUR', effectiveFrom: '2026-01-01' }).expect(201); // correction
    await post(admin, '/cost-rates', { levelId: levels.J, amount: 1200, unit: 'HOUR', effectiveFrom: '2026-06-01' }).expect(201);
    expect((await post(admin, '/cost-rates', { levelId: levels.J, amount: 1, unit: 'HOUR', effectiveFrom: '2026-03-01' }).expect(409)).body.code).toBe('RATE_DATE_BEFORE_CURRENT');
    const j = (await admin.agent.get('/api/cost-rates').expect(200)).body.levels.find((l: { code: string }) => l.code === 'J');
    expect(j.periods.map((p: { amount: number; effectiveFrom: string; effectiveTo: string | null }) => [p.amount, p.effectiveFrom, p.effectiveTo])).toEqual([
      [1200, '2026-06-01', null],
      [1000, '2026-01-01', '2026-05-31'],
    ]);
  });

  it('legacy amounts can be loaded in one step with the chosen unit', async () => {
    await post(admin, '/cost-rates/legacy', { unit: 'DAY', effectiveFrom: '2026-01-01', minutesPerDay: 540 }).expect(409); // J already has a later rate
    await prisma.costRate.deleteMany({ where: { levelId: levels.J } });
    await post(admin, '/cost-rates/legacy', { unit: 'DAY', effectiveFrom: '2026-01-01' }).expect(201);
    const body = (await admin.agent.get('/api/cost-rates').expect(200)).body;
    const s = body.levels.find((l: { code: string }) => l.code === 'S');
    expect(s.current).toMatchObject({ amount: 4000, unit: 'DAY', minutesPerDay: 540 });
  });
});

describe('promotion keeps history', () => {
  it('level change on a date closes the old period; earlier dates are refused', async () => {
    await patch(admin, `/employees/${personId}`, { levelId: levels.S, levelEffectiveFrom: '2026-07-01' }).expect(200);
    const hist = await prisma.employeeLevelHistory.findMany({ where: { employeeId: personId }, orderBy: { effectiveFrom: 'asc' } });
    expect(hist.map((h) => [h.levelId, h.effectiveFrom.toISOString().slice(0, 10), h.effectiveTo?.toISOString().slice(0, 10) ?? null])).toEqual([
      [levels.J, '2026-01-01', '2026-06-30'],
      [levels.S, '2026-07-01', null],
    ]);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: personId } })).levelId).toBe(levels.S);
    expect((await patch(admin, `/employees/${personId}`, { levelId: levels.M, levelEffectiveFrom: '2026-02-01' }).expect(409)).body.code).toBe('LEVEL_DATE_BEFORE_CURRENT');
    const profile = (await admin.agent.get(`/api/employees/${personId}`).expect(200)).body;
    expect(profile.levelHistory.map((h: { code: string }) => h.code)).toEqual(['S', 'J']);
  });
});

describe('customer cost report', () => {
  const row = (body: { customers: { code: string }[] }) => body.customers.find((c) => c.code === customerCode) as unknown as { minutes: number; cost: number; byLevel: Record<string, { cost: number }> };

  it('CURRENT prices every hour at today\'s level (legacy); AT_DATE uses the level on the day', async () => {
    // Rates (DAY, 540 min): J 1,000 · S 4,000
    const current = (await admin.agent.get('/api/reports/customer-cost?from=2026-01-01&to=2026-12-31&basis=CURRENT').expect(200)).body;
    expect(row(current)).toMatchObject({ minutes: 1020, cost: 7555.56 }); // (480 + 540) min × 4,000 / 540
    const atDate = (await admin.agent.get('/api/reports/customer-cost?from=2026-01-01&to=2026-12-31&basis=AT_DATE').expect(200)).body;
    expect(row(atDate)).toMatchObject({ minutes: 1020, cost: 4888.89 }); // 480 × 1,000/540 + 540 × 4,000/540
    expect(row(atDate).byLevel.J.cost).toBe(888.89);
    expect(atDate.units).toEqual(['DAY/540']);
  });

  it('leave is reported apart from customers', async () => {
    const r = (await admin.agent.get('/api/reports/customer-cost?from=2026-07-01&to=2026-07-31').expect(200)).body;
    expect(r.internal.find((i: { type: string }) => i.type === 'LEAVE')).toMatchObject({ minutes: 540, cost: 4000 });
    expect(r.customers.some((c: { code: string }) => c.code === 'PAS')).toBe(false);
  });

  it('hours without a rate are counted as unpriced, never as zero cost', async () => {
    await prisma.costRate.deleteMany({ where: { levelId: levels.S } });
    const r = (await admin.agent.get('/api/reports/customer-cost?from=2026-07-01&to=2026-07-31').expect(200)).body;
    expect(row(r)).toMatchObject({ minutes: 540, cost: 0, unpricedMinutes: 540 });
    expect(r.missing.NO_RATE).toBeGreaterThanOrEqual(540);
  });

  it('detail per customer (legacy j_query.php?com_ was public) needs login + cost.read and follows the scope', async () => {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { code: customerCode } });
    const url = `/api/reports/customer-cost/${customer.id}?from=2026-01-01&to=2026-12-31&basis=AT_DATE`;
    const detail = (await admin.agent.get(url).expect(200)).body;
    expect(detail.rows.map((r: { level: string; cost: number | null }) => [r.level, r.cost])).toEqual([
      ['J', 888.89],
      ['S', null], // rate removed in the previous test
    ]);
    expect((await manager.agent.get(url).expect(200)).body.rows).toHaveLength(2); // same team
    await employee.agent.get(url).expect(403);
  });
});

describe('interactive report rows (/reports/analytics)', () => {
  type Analytics = {
    priced: boolean;
    customers: { code: string }[];
    activities: { type: string }[];
    employees: { id: string }[];
    rows: [string, number, number, number, string, number, number | null][];
  };
  const mine = (a: Analytics) => a.rows.filter((r) => a.employees[r[3]].id === personId);
  const url = '/api/reports/analytics?from=2026-01-01&to=2026-12-31&basis=AT_DATE';

  it('one row per entry, priced exactly like the customer detail (unpriced stays null, never 0)', async () => {
    const a: Analytics = (await admin.agent.get(url).expect(200)).body;
    expect(a.priced).toBe(true);
    expect(mine(a).map((r) => [r[0], a.customers[r[1]].code, r[4], r[5], r[6]])).toEqual([
      ['2026-03-02', customerCode, 'J', 480, 888.89],
      ['2026-07-01', customerCode, 'S', 540, null], // S rate removed above
      ['2026-07-02', 'PAS', 'S', 540, null], //       leave: same row shape, told apart by activity type
    ]);
    expect(a.activities[mine(a)[2][2]].type).toBe('LEAVE');
  });

  it('hours for report readers without cost.read; employees are refused; scope still applies', async () => {
    const p: Analytics = (await partner.agent.get(url).expect(200)).body;
    expect(p.priced).toBe(false);
    expect(p.rows.length).toBeGreaterThan(0);
    expect(p.rows.every((r) => r[6] === null)).toBe(true);
    expect(mine((await manager.agent.get(url).expect(200)).body)).toHaveLength(3); // same team
    await employee.agent.get(url).expect(403);
  });
});
