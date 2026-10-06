import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { login, prisma, Session, startApp } from './helpers';

/**
 * HR leave (docs/09): file → team lead approves → read-only timesheet rows; HR sees everything.
 * People: a team led by `manager` with `employee` and `employee2`; `outsider` in a team with no lead; `hr` from the seed.
 */
let app: INestApplication;
let employee: Session;
let employee2: Session;
let manager: Session;
let outsider: Session;
let hr: Session;
const types: Record<string, string> = {};
let week: string[]; // Mon..Fri of a holiday-free week, well in the future

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (date: string, n: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));
const post = (s: Session, url: string, body: object) => s.agent.post(url).set('X-CSRF-Token', s.csrf).send(body);
const put = (s: Session, url: string, body: object) => s.agent.put(url).set('X-CSRF-Token', s.csrf).send(body);
const file = (s: Session, body: object) => post(s, '/api/leave/requests', body);

/** Own team and people: other spec files change seed users' schedules and teams, which (rightly) changes leave maths. */
async function person(email: string, fullName: string, orgUnitId: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'EMPLOYEE' } });
  const e = await prisma.employee.create({ data: { email, fullName, orgUnitId, startDate: new Date('2024-01-01T00:00:00Z'), roleAssignments: { create: { roleId: role.id } } } });
  return e.id;
}

beforeAll(async () => {
  app = await startApp();
  const stamp = Date.now();
  const team = await prisma.orgUnit.create({ data: { name: `ทีมทดสอบการลา ${stamp}` } });
  const solo = await prisma.orgUnit.create({ data: { name: `ทีมไม่มีหัวหน้า ${stamp}` } });
  const leadId = await person(`leave-lead-${stamp}@pas.test`, 'หัวหน้า ทีมลา', team.id);
  await prisma.orgUnit.update({ where: { id: team.id }, data: { managerId: leadId } });
  await person(`leave-a-${stamp}@pas.test`, 'พนักงานเอ ทีมลา', team.id);
  await person(`leave-b-${stamp}@pas.test`, 'พนักงานบี ทีมลา', team.id);
  await person(`leave-solo-${stamp}@pas.test`, 'พนักงาน ไม่มีหัวหน้า', solo.id);
  [employee, employee2, manager, outsider, hr] = await Promise.all(
    [`leave-a-${stamp}@pas.test`, `leave-b-${stamp}@pas.test`, `leave-lead-${stamp}@pas.test`, `leave-solo-${stamp}@pas.test`, 'hr@pas.test'].map((e) => login(app, e)),
  );
  for (const t of await prisma.leaveType.findMany()) types[t.key] = t.id;
  // First Monday ≥ 30 days ahead whose week has no holiday.
  const holidays = new Set((await prisma.holiday.findMany()).map((h) => iso(h.date)));
  let monday = plus(iso(new Date()), 30);
  while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = plus(monday, 1);
  while ([0, 1, 2, 3, 4, 5, 6].some((i) => holidays.has(plus(monday, i)))) monday = plus(monday, 7);
  week = [0, 1, 2, 3, 4].map((i) => plus(monday, i));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('balances', () => {
  it('start from the legal defaults (1 day = 540 min); annual leave needs 1 year of service', async () => {
    const year = Number(week[0].slice(0, 4));
    const me = await employee.agent.get(`/api/leave/me?year=${year}`).expect(200);
    const by = Object.fromEntries(me.body.balances.map((b: { type: { key: string }; entitledMinutes: number }) => [b.type.key, b.entitledMinutes]));
    expect(by).toEqual({ VACATION: 3240, PERSONAL: 1620, SICK: 16200 });
    expect(me.body.approver).toBe('หัวหน้า ทีมลา');

    const newcomer = await prisma.employee.create({ data: { fullName: 'พนักงาน ใหม่', startDate: new Date(`${year}-06-01T00:00:00Z`) } });
    const hrView = await hr.agent.get(`/api/leave/entitlements?year=${year}`).expect(200);
    const row = hrView.body.rows.find((r: { employee: { id: string } }) => r.employee.id === newcomer.id);
    expect(row.balances.find((b: { type: { key: string } }) => b.type.key === 'VACATION').entitledMinutes).toBe(0);
    await employee.agent.get(`/api/leave/entitlements?year=${year}`).expect(403);
  });

  it('counts leave recorded in the timesheet before this module (legacy rows) as used', async () => {
    const year = Number(week[0].slice(0, 4));
    const sick = await prisma.leaveType.findUniqueOrThrow({ where: { key: 'SICK' } });
    const engagement = await prisma.engagement.findFirstOrThrow({ where: { workCategoryId: sick.workCategoryId, periodStart: null } });
    await prisma.timeEntry.create({
      data: { employeeId: employee2.userId, engagementId: engagement.id, workDate: new Date(`${year}-01-05T00:00:00Z`), durationMinutes: 540, status: 'MIGRATED', createdById: employee2.userId, updatedById: employee2.userId },
    });
    const me = await employee2.agent.get(`/api/leave/me?year=${year}`).expect(200);
    expect(me.body.balances.find((b: { type: { key: string } }) => b.type.key === 'SICK')).toMatchObject({ usedMinutes: 540, remainingMinutes: 15660 });
  });
});

describe('file → approve → timesheet', () => {
  let id: string;

  it('charges working days only (Fri + Mon over a weekend) and waits for the team lead', async () => {
    const body = { leaveTypeId: types.VACATION, unit: 'DAYS', startDate: week[4], endDate: plus(week[4], 3) }; // Fri..Mon
    const preview = await post(employee, '/api/leave/preview', body).expect(201);
    expect(preview.body).toMatchObject({ ok: true, minutes: 1080, overQuota: false });
    expect(preview.body.days.map((d: { date: string }) => d.date)).toEqual([week[4], plus(week[4], 3)]);

    const res = await file(employee, { ...body, reason: 'พาครอบครัวเที่ยว' }).expect(201);
    expect(res.body).toMatchObject({ status: 'PENDING', minutes: 1080 });
    id = res.body.id;
  });

  it('only the team lead (or HR) decides; colleagues cannot even read it', async () => {
    await post(employee, `/api/leave/requests/${id}/decision`, { decision: 'APPROVE', expectedVersion: 1 }).expect(403);
    await post(employee2, `/api/leave/requests/${id}/decision`, { decision: 'APPROVE', expectedVersion: 1 }).expect(403);
    await outsider.agent.get(`/api/leave/requests/${id}`).expect(403);
    const queue = await manager.agent.get('/api/leave/approvals').expect(200);
    expect(queue.body.map((r: { id: string }) => r.id)).toContain(id);
    const bell = await manager.agent.get('/api/notifications').expect(200);
    expect(JSON.stringify(bell.body)).toContain('LEAVE_APPROVALS');
  });

  it('approval posts read-only leave rows into the timesheet and queues the calendar mirror', async () => {
    const res = await post(manager, `/api/leave/requests/${id}/decision`, { decision: 'APPROVE', note: 'ok', expectedVersion: 1 }).expect(201);
    expect(res.body).toMatchObject({ status: 'APPROVED', decidedBy: 'หัวหน้า ทีมลา' });
    const rows = await prisma.timeEntry.findMany({ where: { leaveRequestId: id, deletedAt: null }, orderBy: { workDate: 'asc' } });
    expect(rows.map((r) => [iso(r.workDate), r.durationMinutes, r.status])).toEqual([
      [week[4], 540, 'APPROVED'],
      [plus(week[4], 3), 540, 'APPROVED'],
    ]);
    expect(await prisma.calendarSync.findUnique({ where: { kind_resourceId: { kind: 'leave_request', resourceId: id } } })).toMatchObject({ status: 'PENDING' });

    // The timesheet refuses to edit those rows, and refuses leave typed in by hand.
    const entry = rows[0];
    await employee.agent.delete(`/api/time-report/entries/${entry.id}?version=${entry.version}`).set('X-CSRF-Token', employee.csrf).expect(422);
    const manual = await put(employee, '/api/time-report/entries', { engagementId: entry.engagementId, workDate: week[0], durationMinutes: 540 });
    expect(manual.status).toBe(422);
    expect(manual.body.code).toBe('LEAVE_USE_REQUEST');

    const year = Number(week[4].slice(0, 4));
    const me = await employee.agent.get(`/api/leave/me?year=${year}`).expect(200);
    expect(me.body.balances.find((b: { type: { key: string } }) => b.type.key === 'VACATION')).toMatchObject({ usedMinutes: 1080, remainingMinutes: 2160 });
  });

  it('refuses overlapping leave: same type twice, or more than the working day', async () => {
    const same = await file(employee, { leaveTypeId: types.VACATION, unit: 'HOURS', startDate: week[4], endDate: week[4], minutes: 60, reason: 'x' }).expect(409);
    expect(same.body.code).toBe('LEAVE_SAME_DAY');
    const over = await file(employee, { leaveTypeId: types.PERSONAL, unit: 'HOURS', startDate: week[4], endDate: week[4], minutes: 120, reason: 'x' }).expect(409);
    expect(over.body.code).toBe('LEAVE_OVERLAP');
    await file(employee, { leaveTypeId: types.PERSONAL, unit: 'DAYS', startDate: plus(week[0], 5), endDate: plus(week[0], 6), reason: 'เสาร์อาทิตย์' }).expect(422);
  });

  it('the requester cancels approved leave before it starts: rows leave the timesheet', async () => {
    const r = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    const res = await post(employee, `/api/leave/requests/${id}/cancel`, { reason: 'เลื่อนทริป', expectedVersion: r.version }).expect(201);
    expect(res.body.status).toBe('CANCELLED');
    expect(await prisma.timeEntry.count({ where: { leaveRequestId: id, deletedAt: null } })).toBe(0);
  });
});

describe('hours, quota, rejection', () => {
  it('hourly leave in 30-minute steps', async () => {
    await file(employee, { leaveTypeId: types.PERSONAL, unit: 'HOURS', startDate: week[1], endDate: week[1], minutes: 100, reason: 'ธนาคาร' }).expect(422);
    const ok = await file(employee, { leaveTypeId: types.PERSONAL, unit: 'HOURS', startDate: week[1], endDate: week[1], minutes: 180, reason: 'ธนาคาร' }).expect(201);
    expect(ok.body).toMatchObject({ unit: 'HOURS', minutes: 180, overQuota: false });
  });

  it('going over the entitlement is allowed but flagged for the approver', async () => {
    const res = await file(employee2, { leaveTypeId: types.PERSONAL, unit: 'DAYS', startDate: week[0], endDate: week[3], reason: 'ธุระที่ต่างจังหวัด' }).expect(201);
    expect(res.body).toMatchObject({ minutes: 2160, overQuota: true });
    await post(manager, `/api/leave/requests/${res.body.id}/decision`, { decision: 'REJECT', expectedVersion: 1 }).expect(400);
    const rejected = await post(manager, `/api/leave/requests/${res.body.id}/decision`, { decision: 'REJECT', note: 'เกินสิทธิ์ ขอแบ่งเป็นพักร้อน', expectedVersion: 1 }).expect(201);
    expect(rejected.body).toMatchObject({ status: 'REJECTED', decisionNote: 'เกินสิทธิ์ ขอแบ่งเป็นพักร้อน' });
  });

  it('sick leave of 3+ days asks for a medical certificate', async () => {
    const p = await post(employee2, '/api/leave/preview', { leaveTypeId: types.SICK, unit: 'DAYS', startDate: plus(week[0], 7), endDate: plus(week[0], 9) }).expect(201);
    expect(p.body.needsCertificate).toBe(true);
  });
});

describe('HR', () => {
  it('handles requests from a team with no lead; team leads are not shown them', async () => {
    const res = await file(outsider, { leaveTypeId: types.SICK, unit: 'DAYS', startDate: week[2], endDate: week[2], reason: 'ไข้หวัด' }).expect(201);
    const forManager = await manager.agent.get('/api/leave/approvals').expect(200);
    expect(forManager.body.map((r: { id: string }) => r.id)).not.toContain(res.body.id);
    const forHr = await hr.agent.get('/api/leave/approvals').expect(200);
    expect(forHr.body.find((r: { id: string }) => r.id === res.body.id)).toMatchObject({ noTeamApprover: true });
    await post(hr, `/api/leave/requests/${res.body.id}/decision`, { decision: 'APPROVE', expectedVersion: 1 }).expect(201);
  });

  it('records leave on someone’s behalf already approved, but never approves their own', async () => {
    const employee2Id = employee2.userId;
    const res = await file(hr, { employeeId: employee2Id, leaveTypeId: types.SICK, unit: 'DAYS', startDate: plus(week[0], 14), endDate: plus(week[0], 14), reason: 'ใบลากระดาษ', approve: true }).expect(201);
    expect(res.body).toMatchObject({ status: 'APPROVED', filedBy: 'บุคคล ทดสอบ' });
    await file(hr, { leaveTypeId: types.SICK, unit: 'DAYS', startDate: plus(week[0], 14), endDate: plus(week[0], 14), reason: 'x', approve: true }).expect(403);
    await file(employee, { employeeId: employee2Id, leaveTypeId: types.SICK, unit: 'DAYS', startDate: week[0], endDate: week[0], reason: 'x' }).expect(403);
  });

  it('overrides an entitlement for one person and year', async () => {
    const year = Number(week[0].slice(0, 4));
    const res = await put(hr, '/api/leave/entitlements', { employeeId: employee.userId, leaveTypeId: types.VACATION, year, minutes: 5400, note: 'อายุงาน 5 ปี' }).expect(200);
    expect(res.body).toMatchObject({ entitledMinutes: 5400, overridden: true });
    await put(employee, '/api/leave/entitlements', { employeeId: employee.userId, leaveTypeId: types.VACATION, year, minutes: 99999 }).expect(403);
  });
});

it('approval recalculates days if a holiday was added after filing', async () => {
  const res = await file(employee2, { leaveTypeId: types.VACATION, unit: 'DAYS', startDate: plus(week[0], 21), endDate: plus(week[0], 23), reason: 'พักผ่อน' }).expect(201);
  expect(res.body.minutes).toBe(1620);
  const holiday = await prisma.holiday.create({ data: { date: new Date(`${plus(week[0], 22)}T00:00:00Z`), description: 'วันหยุดพิเศษ (ทดสอบ)' } });
  try {
    const approved = await post(manager, `/api/leave/requests/${res.body.id}/decision`, { decision: 'APPROVE', expectedVersion: 1 }).expect(201);
    expect(approved.body.minutes).toBe(1080);
    expect(approved.body.days.map((d: { date: string }) => d.date)).toEqual([plus(week[0], 21), plus(week[0], 23)]);
  } finally {
    await prisma.holiday.delete({ where: { id: holiday.id } });
  }
});

it('team calendar: colleagues see who is away, not the type', async () => {
  const month = week[2].slice(0, 7);
  const asColleague = await employee2.agent.get(`/api/leave/calendar?month=${month}`).expect(200);
  const hourly = asColleague.body.entries.find((e: { employee: { id: string }; unit: string }) => e.employee.id === employee.userId && e.unit === 'HOURS');
  expect(hourly).toMatchObject({ type: null });
  const asLead = await manager.agent.get(`/api/leave/calendar?month=${month}`).expect(200);
  expect(asLead.body.entries.find((e: { id: string }) => e.id === hourly.id).type).toMatchObject({ name: 'ลากิจ' });
  await request(app.getHttpServer()).get(`/api/leave/calendar?month=${month}`).expect(401);
});
