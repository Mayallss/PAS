import { INestApplication } from '@nestjs/common';
import { login, prisma, Session, startApp } from './helpers';

let app: INestApplication;
/** `employee2` here is a dedicated person (other spec files share the database and hand out computers too). */
let employee: Session, employee2: Session, itUser: Session;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
let notebook: string, monitor: string;

const post = (s: Session, path: string, body: object) => s.agent.post(`/api${path}`).set('X-CSRF-Token', s.csrf).send(body);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a20000000049454e44ae426082', 'hex');

beforeAll(async () => {
  app = await startApp();
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'EMPLOYEE' } });
  for (const email of ['req-user@pas.test', 'req-other@pas.test']) {
    const e = await prisma.employee.upsert({ where: { email }, update: {}, create: { email, fullName: `ผู้แจ้ง ${email.split('@')[0]}` } });
    await prisma.roleAssignment.createMany({ data: [{ employeeId: e.id, roleId: role.id }], skipDuplicates: true });
  }
  [employee, employee2, itUser] = await Promise.all(['req-other', 'req-user', 'it'].map((u) => login(app, `${u}@pas.test`)));
  notebook = (await prisma.assetCategory.findUniqueOrThrow({ where: { key: 'NOTEBOOK' } })).id;
  monitor = (await prisma.assetCategory.findUniqueOrThrow({ where: { key: 'MONITOR' } })).id;
  // employee2 gets a laptop of their own for these tests (the seed already gives one to employee).
  await post(itUser, '/assets', { code: 'NB-0700', categoryId: notebook, brand: 'ASUS', specs: { ram: '8 GB' } }).expect(201);
  await post(itUser, '/assets/NB-0700/assign', { employeeId: employee2.userId, kind: 'PRIMARY', startDate: '2026-09-01' }).expect(201);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('employee view of their own device', () => {
  it('shows only their device with its state and history — not the register, not costs', async () => {
    await employee.agent.get('/api/assets').expect(403);
    await employee.agent.get('/api/assets/NB-0700').expect(403);
    const mine = (await employee2.agent.get('/api/assets/mine').expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ code: 'NB-0700', state: 'IN_USE', specs: { ram: '8 GB' } });
    expect(mine[0].history.map((h: { type: string }) => h.type)).toEqual(expect.arrayContaining(['ASSIGNED', 'REGISTERED']));
    expect(JSON.stringify(mine[0])).not.toContain('cost');
  });
});

describe('one computer per person', () => {
  it('refuses a second computer, allows a swap, a monitor, and a loan while the own machine is in repair', async () => {
    await post(itUser, '/assets', { code: 'NB-0701', categoryId: notebook }).expect(201);
    await post(itUser, '/assets', { code: 'MO-0700', categoryId: monitor }).expect(201);

    const refused = await post(itUser, '/assets/NB-0701/assign', { employeeId: employee2.userId, kind: 'PRIMARY', startDate: '2026-09-10' }).expect(409);
    expect(refused.body).toMatchObject({ code: 'ONE_PER_PERSON', holding: ['NB-0700'] });
    await post(itUser, '/assets/MO-0700/assign', { employeeId: employee2.userId, kind: 'PRIMARY', startDate: '2026-09-10' }).expect(201);

    // Swap: NB-0701 replaces NB-0700, which comes back the same day.
    await post(itUser, '/assets/NB-0701/assign', { employeeId: employee2.userId, kind: 'PRIMARY', startDate: '2026-09-10', replaceCurrent: true }).expect(201);
    const old = (await itUser.agent.get('/api/assets/NB-0700').expect(200)).body;
    expect(old).toMatchObject({ state: 'AVAILABLE', holder: null });
    expect(old.assignments[0]).toMatchObject({ endDate: '2026-09-10' });

    // Own machine to repair → a loan of another computer is allowed.
    const nb = (await itUser.agent.get('/api/assets/NB-0701').expect(200)).body;
    await post(itUser, '/assets/NB-0701/events', { type: 'REPAIR', occurredOn: '2026-09-15', title: 'คีย์บอร์ดเสีย', expectedVersion: nb.version }).expect(201);
    await post(itUser, '/assets/NB-0700/assign', { employeeId: employee2.userId, kind: 'PRIMARY', startDate: '2026-09-15' }).expect(409);
    await post(itUser, '/assets/NB-0700/assign', { employeeId: employee2.userId, kind: 'LOAN', startDate: '2026-09-15', dueDate: '2026-09-30' }).expect(201);
    const mine = (await employee2.agent.get('/api/assets/mine').expect(200)).body;
    expect(mine.map((m: { code: string; state: string }) => `${m.code}:${m.state}`).sort()).toEqual(['MO-0700:IN_USE', 'NB-0700:IN_USE', 'NB-0701:IN_REPAIR']);

    // Clean up for the request tests: repair done, loan returned.
    const inRepair = (await itUser.agent.get('/api/assets/NB-0701').expect(200)).body;
    const repair = inRepair.events.find((e: { openRepair: boolean }) => e.openRepair);
    await post(itUser, `/assets/NB-0701/events/${repair.id}/complete`, { completedOn: '2026-09-20', expectedVersion: inRepair.version }).expect(201);
    await post(itUser, '/assets/NB-0700/return', { date: '2026-09-20' }).expect(201);
  });

  it('lists by state, with counts per state', async () => {
    const res = (await itUser.agent.get('/api/assets?state=AVAILABLE').expect(200)).body;
    expect(res.rows.every((r: { state: string }) => r.state === 'AVAILABLE')).toBe(true);
    expect(res.rows.map((r: { code: string }) => r.code)).toContain('NB-0700');
    expect(res.summary.byState.AVAILABLE).toBe(res.rows.length);
    expect(res.summary.byState).toHaveProperty('IN_REPAIR');
  });
});

describe('requests', () => {
  let requestId: string;

  it('an employee reports a problem with their own computer (picked automatically) and it shows in the device history', async () => {
    const res = await post(employee2, '/it-requests', { type: 'REPAIR', title: 'เปิดไม่ติด', detail: 'กดปุ่ม power แล้วไฟไม่ขึ้น', urgency: 'URGENT' }).expect(201);
    requestId = res.body.id;
    expect(res.body).toMatchObject({ status: 'SUBMITTED', urgency: 'URGENT', asset: { code: 'NB-0701' }, updates: [{ toStatus: 'SUBMITTED' }] });
    const d = (await itUser.agent.get('/api/assets/NB-0701').expect(200)).body;
    expect(d.events.find((e: { type: string; requestNumber: number | null }) => e.type === 'ISSUE')).toMatchObject({ requestNumber: res.body.number, title: 'แจ้งซ่อม: เปิดไม่ติด' });
    expect(d.requests[0]).toMatchObject({ id: requestId, status: 'SUBMITTED' });

    const dup = await post(employee2, '/it-requests', { type: 'REPAIR', title: 'ซ้ำ' }).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_REQUEST');
    // Not your device / no device.
    await post(employee2, '/it-requests', { type: 'REPAIR', assetCode: 'NB-0101', title: 'x' }).expect(403); // the seeded employee's laptop
    const outsider = await login(app, 'outsider@pas.test');
    expect((await post(outsider, '/it-requests', { type: 'REPAIR', title: 'x' }).expect(400)).body.code).toBe('DEVICE_REQUIRED');
    await post(outsider, '/it-requests', { type: 'SOFTWARE', title: 'ขอลงโปรแกรม Excel add-in' }).expect(201);
  });

  it('photos go with the request and only the requester and IT can open them', async () => {
    const up = await employee2.agent.post(`/api/it-requests/${requestId}/attachments`).set('X-CSRF-Token', employee2.csrf).attach('file', PNG, { filename: 'จอดับ.png' }).expect(201);
    await employee2.agent.get(`/api/it-requests/${requestId}/attachments/${up.body.id}/file`).expect(200);
    await itUser.agent.get(`/api/it-requests/${requestId}/attachments/${up.body.id}/file`).expect(200);
    await employee.agent.get(`/api/it-requests/${requestId}/attachments/${up.body.id}/file`).expect(404);
    await employee.agent.get(`/api/it-requests/${requestId}`).expect(404);
    await post(employee, `/it-requests/${requestId}/cancel`, {}).expect(403);
  });

  it('IT sees new requests in the bell and the queue', async () => {
    const bell = (await itUser.agent.get('/api/notifications').expect(200)).body;
    expect(bell.items.find((i: { kind: string }) => i.kind === 'IT_REQUESTS')?.count).toBeGreaterThanOrEqual(2);
    const queue = (await itUser.agent.get('/api/it-requests').expect(200)).body;
    expect(queue[0].urgency).toBe('URGENT'); // urgent first
    await employee.agent.get('/api/it-requests').expect(403);
  });

  it('IT takes it, sends the device to repair, then resolves: device state follows', async () => {
    await post(employee2, `/it-requests/${requestId}/status`, { status: 'IN_PROGRESS' }).expect(403);
    let r = (await post(itUser, `/it-requests/${requestId}/status`, { status: 'IN_PROGRESS', note: 'ส่งร้าน', sendToRepair: true, underWarranty: true }).expect(201)).body;
    expect(r).toMatchObject({ status: 'IN_PROGRESS', repairOpen: true, handler: 'ไอที ทดสอบ', asset: { state: 'IN_REPAIR' } });
    expect((await employee2.agent.get('/api/assets/mine').expect(200)).body.find((m: { code: string }) => m.code === 'NB-0701').state).toBe('IN_REPAIR');

    await post(itUser, `/it-requests/${requestId}/status`, { status: 'IN_PROGRESS', note: 'ร้านแจ้งว่ารออะไหล่ 3 วัน' }).expect(201); // progress note
    expect((await post(itUser, `/it-requests/${requestId}/status`, { status: 'REJECTED', note: 'x' }).expect(409)).body.code).toBe('REPAIR_OPEN');
    r = (await post(itUser, `/it-requests/${requestId}/status`, { status: 'RESOLVED', note: 'เปลี่ยนเมนบอร์ด', completedOn: today, cost: 0 }).expect(201)).body;
    expect(r).toMatchObject({ status: 'RESOLVED', repairOpen: false, resolution: 'เปลี่ยนเมนบอร์ด', asset: { state: 'IN_USE' } });
    expect(r.updates.map((u: { toStatus: string }) => u.toStatus)).toEqual(['SUBMITTED', 'IN_PROGRESS', 'IN_PROGRESS', 'RESOLVED']);
    await post(itUser, `/it-requests/${requestId}/status`, { status: 'IN_PROGRESS', note: 'reopen' }).expect(409);

    const d = (await itUser.agent.get('/api/assets/NB-0701').expect(200)).body;
    const repair = d.events.find((e: { type: string; requestNumber: number | null }) => e.type === 'REPAIR' && e.requestNumber === r.number);
    expect(repair).toMatchObject({ completedOn: today, underWarranty: true });
  });

  it('requester can cancel only before IT takes it; rejecting needs a reason', async () => {
    const a = (await post(employee2, '/it-requests', { type: 'UPGRADE', title: 'ขอเพิ่มแรม' }).expect(201)).body;
    await post(employee2, `/it-requests/${a.id}/cancel`, { reason: 'ไม่ต้องแล้ว' }).expect(201);
    const b = (await post(employee2, '/it-requests', { type: 'UPGRADE', title: 'ขอเพิ่มแรม (อีกครั้ง)' }).expect(201)).body;
    await post(itUser, `/it-requests/${b.id}/status`, { status: 'REJECTED' }).expect(400);
    await post(itUser, `/it-requests/${b.id}/status`, { status: 'REJECTED', note: 'สเปกเพียงพอแล้ว' }).expect(201);
    await post(employee2, `/it-requests/${b.id}/cancel`, {}).expect(409);
    const mine = (await employee2.agent.get('/api/it-requests/mine').expect(200)).body;
    expect(mine.map((m: { status: string }) => m.status)).toEqual(['REJECTED', 'CANCELLED', 'RESOLVED']);
  });
});
