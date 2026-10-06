import { INestApplication } from '@nestjs/common';
import { login, prisma, Session, startApp } from './helpers';

let app: INestApplication;
let employee: Session, employee2: Session, admin: Session, itUser: Session;
let notebook: string, monitor: string;

const post = (s: Session, path: string, body: object) => s.agent.post(`/api${path}`).set('X-CSRF-Token', s.csrf).send(body);
const patch = (s: Session, path: string, body: object) => s.agent.patch(`/api${path}`).set('X-CSRF-Token', s.csrf).send(body);
const detail = async (code: string) => (await itUser.agent.get(`/api/assets/${code}`).expect(200)).body;

// Smallest valid PNG (1×1) — the server identifies files by their bytes, not by name.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a20000000049454e44ae426082', 'hex');

beforeAll(async () => {
  app = await startApp();
  [employee, employee2, admin, itUser] = await Promise.all(['employee', 'employee2', 'admin', 'it'].map((u) => login(app, `${u}@pas.test`)));
  notebook = (await prisma.assetCategory.findUniqueOrThrow({ where: { key: 'NOTEBOOK' } })).id;
  monitor = (await prisma.assetCategory.findUniqueOrThrow({ where: { key: 'MONITOR' } })).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('access', () => {
  it('only IT/Admin see the register; everyone sees their own devices', async () => {
    await employee.agent.get('/api/assets').expect(403);
    await post(employee, '/assets', { code: 'NB-9999', categoryId: notebook }).expect(403);
    await itUser.agent.get('/api/assets').expect(200);
    await admin.agent.get('/api/assets').expect(200);
    await employee.agent.get('/api/assets/mine').expect(200);
  });
});

describe('register', () => {
  it('keeps legacy codes, normalises case and rejects duplicates', async () => {
    const res = await post(itUser, '/assets', {
      code: 'nb-0011',
      categoryId: notebook,
      brand: 'LENOVO',
      model: '130-14IKB',
      serialNo: 'MP1GQKZ9',
      specs: { cpu: 'Intel I3-6006U', ram: '4GB', storage: 'HDD 1 TB', os: '11 home' },
      purchaseDate: '2019-03-03',
      cost: 10186.91,
    }).expect(201);
    expect(res.body.code).toBe('NB-0011');
    await post(itUser, '/assets', { code: 'NB-0011', categoryId: notebook }).expect(409);
    expect((await post(itUser, '/assets', { code: 'NB-0012', categoryId: notebook, serialNo: 'MP1GQKZ9' }).expect(409)).body.message).toContain('Serial');
    await post(itUser, '/assets', { code: 'NB 12', categoryId: notebook }).expect(400);
    await post(itUser, '/assets', { code: 'NB-0017-1', categoryId: notebook }).expect(201);

    const d = await detail('nb-0011');
    expect(d.specs).toEqual({ cpu: 'Intel I3-6006U', ram: '4GB', storage: 'HDD 1 TB', os: '11 home' });
    expect(d.events.map((e: { type: string }) => e.type)).toEqual(['REGISTERED']);
    expect(d.ageYears).toBeGreaterThanOrEqual(7);
    expect(d.usefulLifeEnds).toBe('2024-03-03');
  });

  it('suggests the next free number and never reuses one', async () => {
    await post(itUser, '/assets', { code: 'NB-0048', categoryId: notebook }).expect(201);
    await post(itUser, '/assets', { code: 'NB-9000', categoryId: notebook }).expect(201);
    expect((await itUser.agent.get(`/api/assets/next-code?categoryId=${notebook}`).expect(200)).body.code).toBe('NB-9001');
    // Other spec files share the database: compute the expectation from what exists.
    const monitors = await prisma.asset.findMany({ where: { categoryId: monitor }, select: { code: true } });
    const nextMonitor = Math.max(0, ...monitors.map((m) => Number(/^MO-(\d+)$/.exec(m.code)?.[1] ?? 0))) + 1;
    expect((await itUser.agent.get(`/api/assets/next-code?categoryId=${monitor}`).expect(200)).body.code).toBe(`MO-${String(nextMonitor).padStart(4, '0')}`);
  });
});

describe('hand out, move, lend, return', () => {
  let employeeId: string, employee2Id: string, serverRoom: string;

  beforeAll(async () => {
    employeeId = (await prisma.employee.create({ data: { fullName: 'ผู้ถือ ทดสอบ', nickname: 'ถือ' } })).id; // holds no computer yet
    employee2Id = employee2.userId;
    // employee2 must hold no computer here (other spec files share the database).
    await prisma.assetAssignment.updateMany({ where: { employeeId: employee2Id, endDate: null }, data: { endDate: new Date('2026-01-01T00:00:00Z') } });
    serverRoom = (await post(itUser, '/assets/locations', { name: 'ห้อง Server' }).expect(201)).body.id;
  });

  it('assigns, then moves in one action (old period closed on the same day)', async () => {
    await post(itUser, '/assets/NB-0011/assign', { employeeId, kind: 'PRIMARY', startDate: '2026-02-01' }).expect(201);
    await post(itUser, '/assets/NB-0011/assign', { employeeId, kind: 'PRIMARY', startDate: '2026-02-05' }).expect(409); // already holds it
    await post(itUser, '/assets/NB-0011/assign', { employeeId: employee2Id, kind: 'PRIMARY', startDate: '2026-01-15' }).expect(409); // before current holder
    await post(itUser, '/assets/NB-0011/assign', { employeeId: employee2Id, kind: 'PRIMARY', startDate: '2026-03-01' }).expect(201);

    const d = await detail('NB-0011');
    expect(d.holder).toMatchObject({ employeeId: employee2Id, kind: 'PRIMARY', startDate: '2026-03-01' });
    expect(d.assignments.map((a: { startDate: string; endDate: string | null }) => [a.startDate, a.endDate])).toEqual([
      ['2026-03-01', null],
      ['2026-02-01', '2026-03-01'],
    ]);
    expect(d.events.filter((e: { type: string }) => e.type === 'ASSIGNED')).toHaveLength(2);
    expect((await employee2.agent.get('/api/assets/mine').expect(200)).body.map((m: { code: string }) => m.code)).toEqual(['NB-0011']);
    expect((await employee.agent.get('/api/assets/mine').expect(200)).body.map((m: { code: string }) => m.code)).not.toContain('NB-0011');
  });

  it('validates loans and shared devices', async () => {
    // Somebody without a computer (the seeded employee already holds one — 1 person = 1 computer).
    employeeId = (await prisma.employee.create({ data: { fullName: 'ผู้ยืม ทดสอบ', nickname: 'ยืม' } })).id;
    await post(itUser, '/assets/NB-0017-1/assign', { employeeId, kind: 'LOAN', startDate: '2026-09-01' }).expect(400);
    await post(itUser, '/assets/NB-0017-1/assign', { employeeId, kind: 'LOAN', startDate: '2026-09-01', dueDate: '2026-08-01' }).expect(400);
    await post(itUser, '/assets/NB-0017-1/assign', { employeeId, kind: 'SHARED', startDate: '2026-09-01' }).expect(400);
    await post(itUser, '/assets/NB-0017-1/assign', { employeeId, locationId: serverRoom, kind: 'PRIMARY', startDate: '2026-09-01' }).expect(400);
    await post(itUser, '/assets/NB-0017-1/assign', { employeeId, kind: 'LOAN', startDate: '2026-09-01', dueDate: '2026-09-10' }).expect(201);
    const list = (await itUser.agent.get('/api/assets?state=IN_USE').expect(200)).body;
    const row = list.rows.find((r: { code: string }) => r.code === 'NB-0017-1');
    expect(row.holder).toMatchObject({ kind: 'LOAN', overdue: true });
    expect(list.summary.overdueLoans).toBeGreaterThanOrEqual(1);
  });

  it('returns a device; return date cannot precede the start', async () => {
    await post(itUser, '/assets/NB-0017-1/return', { date: '2026-08-31' }).expect(400);
    await post(itUser, '/assets/NB-0017-1/return', { date: '2026-09-12', note: 'คืนช้า 2 วัน' }).expect(201);
    await post(itUser, '/assets/NB-0017-1/return', { date: '2026-09-12' }).expect(409);
    const d = await detail('NB-0017-1');
    expect(d.holder).toBeNull();
    expect(d.events.find((e: { type: string }) => e.type === 'RETURNED')).toMatchObject({ detail: 'คืนช้า 2 วัน', occurredOn: '2026-09-12' });
    await post(itUser, '/assets/NB-0017-1/assign', { locationId: serverRoom, kind: 'SHARED', startDate: '2026-09-12' }).expect(201);
  });

  it('refuses to hand a device to someone who has left', async () => {
    const leaver = await prisma.employee.create({ data: { fullName: 'อดีต พนักงาน', status: 'INACTIVE' } });
    expect((await post(itUser, '/assets/NB-0048/assign', { employeeId: leaver.id, kind: 'PRIMARY', startDate: '2026-09-01' }).expect(409)).body.code).toBe('EMPLOYEE_INACTIVE');
  });
});

describe('history: upgrades, repairs, status, voiding', () => {
  it('an upgrade changes specs and keeps before/after; stale versions are refused', async () => {
    const d = await detail('NB-0011');
    const body = { type: 'UPGRADE', occurredOn: '2026-06-10', title: 'เปลี่ยน HDD เป็น SSD', specChanges: { storage: 'SSD 512 GB', ram: '8 GB' }, cost: 1860, expectedVersion: d.version };
    await post(itUser, '/assets/NB-0011/events', body).expect(201);
    await post(itUser, '/assets/NB-0011/events', body).expect(409); // same version again
    const after = await detail('NB-0011');
    expect(after.specs).toMatchObject({ storage: 'SSD 512 GB', ram: '8 GB', cpu: 'Intel I3-6006U' });
    expect(after.events.find((e: { type: string }) => e.type === 'UPGRADE').specDiff).toEqual({ storage: ['HDD 1 TB', 'SSD 512 GB'], ram: ['4GB', '8 GB'] });
    await post(itUser, '/assets/NB-0011/events', { ...body, specChanges: { storage: 'SSD 512 GB' }, expectedVersion: after.version }).expect(400); // nothing changed
    await post(itUser, '/assets/NB-0011/events', { type: 'NOTE', occurredOn: '2099-01-01', title: 'อนาคต', expectedVersion: after.version }).expect(400);
  });

  it('voiding an upgrade restores specs — only the latest spec change can be voided', async () => {
    let d = await detail('NB-0011');
    await post(itUser, '/assets/NB-0011/events', { type: 'SPEC_CORRECTED', occurredOn: '2026-06-11', title: 'แก้ Windows', specChanges: { os: '11 pro' }, expectedVersion: d.version }).expect(201);
    d = await detail('NB-0011');
    const upgrade = d.events.find((e: { type: string }) => e.type === 'UPGRADE');
    const fix = d.events.find((e: { type: string }) => e.type === 'SPEC_CORRECTED');
    expect((await post(itUser, `/assets/NB-0011/events/${upgrade.id}/void`, { reason: 'ผิดเครื่อง', expectedVersion: d.version }).expect(409)).body.code).toBe('LATER_SPEC_CHANGE');
    await post(itUser, `/assets/NB-0011/events/${fix.id}/void`, { reason: 'บันทึกผิด', expectedVersion: d.version }).expect(201);
    d = await detail('NB-0011');
    expect(d.specs.os).toBe('11 home');
    expect(d.events.find((e: { id: string }) => e.id === fix.id).voidReason).toBe('บันทึกผิด');
    const assigned = d.events.find((e: { type: string }) => e.type === 'ASSIGNED');
    expect((await post(itUser, `/assets/NB-0011/events/${assigned.id}/void`, { reason: 'x', expectedVersion: d.version }).expect(409)).body.code).toBe('SYSTEM_EVENT');
  });

  it('an open repair takes the device out of circulation until it comes back', async () => {
    let d = await detail('NB-0048');
    await post(itUser, '/assets/NB-0048/events', { type: 'REPAIR', occurredOn: '2026-09-01', title: 'จอไม่ติด', underWarranty: true, expectedVersion: d.version }).expect(201);
    d = await detail('NB-0048');
    expect(d.status).toBe('IN_REPAIR');
    expect((await post(itUser, '/assets/NB-0048/assign', { employeeId: employee.userId, kind: 'PRIMARY', startDate: '2026-09-02' }).expect(409)).body.code).toBe('ASSET_NOT_AVAILABLE');
    await post(itUser, '/assets/NB-0048/status', { status: 'RETIRED', occurredOn: '2026-09-02', reason: 'x', expectedVersion: d.version }).expect(409);
    const repair = d.events.find((e: { openRepair: boolean }) => e.openRepair);
    await post(itUser, `/assets/NB-0048/events/${repair.id}/complete`, { completedOn: '2026-08-30', expectedVersion: d.version }).expect(400);
    await post(itUser, `/assets/NB-0048/events/${repair.id}/complete`, { completedOn: '2026-09-08', cost: 0, detail: 'เปลี่ยนสายแพจอ', expectedVersion: d.version }).expect(201);
    d = await detail('NB-0048');
    expect(d.status).toBe('ACTIVE');
    expect(d.events.find((e: { id: string }) => e.id === repair.id)).toMatchObject({ completedOn: '2026-09-08', openRepair: false });
    expect(d.events.find((e: { type: string }) => e.type === 'STATUS_CHANGED')).toMatchObject({ fromStatus: 'IN_REPAIR', toStatus: 'ACTIVE', occurredOn: '2026-09-08' });
  });

  it('a held device cannot be disposed; a disposed one is closed for good', async () => {
    let d = await detail('NB-0011');
    expect((await post(itUser, '/assets/NB-0011/status', { status: 'DISPOSED', occurredOn: '2026-09-20', reason: 'ขายซาก', expectedVersion: d.version }).expect(409)).body.code).toBe('STILL_ASSIGNED');
    await post(itUser, '/assets/NB-0011/return', { date: '2026-09-20' }).expect(201);
    await post(itUser, '/assets/NB-0011/status', { status: 'DISPOSED', occurredOn: '2026-09-21', reason: 'ขายซาก', expectedVersion: d.version }).expect(201);
    d = await detail('NB-0011');
    expect(d.status).toBe('DISPOSED');
    await post(itUser, '/assets/NB-0011/events', { type: 'NOTE', occurredOn: '2026-09-22', title: 'x', expectedVersion: d.version }).expect(409);
    await post(itUser, '/assets/NB-0011/assign', { employeeId: employee.userId, kind: 'PRIMARY', startDate: '2026-09-22' }).expect(409);
  });
});

describe('evidence files', () => {
  it('accepts images/PDF by content, rejects everything else, serves safely, voids instead of deleting', async () => {
    const d = await detail('NB-0048');
    const repair = d.events.find((e: { type: string }) => e.type === 'REPAIR');
    const up = await itUser.agent
      .post('/api/assets/NB-0048/attachments')
      .set('X-CSRF-Token', itUser.csrf)
      .field('kind', 'RECEIPT')
      .field('assetEventId', repair.id)
      .attach('file', PNG, { filename: 'ใบเสร็จ.png', contentType: 'image/png' })
      .expect(201);
    expect(up.body).toMatchObject({ fileName: 'ใบเสร็จ.png', mimeType: 'image/png' });

    // A script renamed to .pdf is refused.
    await itUser.agent
      .post('/api/assets/NB-0048/attachments')
      .set('X-CSRF-Token', itUser.csrf)
      .field('kind', 'OTHER')
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'invoice.pdf', contentType: 'application/pdf' })
      .expect(415);
    // Too large (UPLOAD_MAX_MB=1 in tests).
    await itUser.agent
      .post('/api/assets/NB-0048/attachments')
      .set('X-CSRF-Token', itUser.csrf)
      .field('kind', 'PHOTO')
      .attach('file', Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]), { filename: 'big.png' })
      .expect(413);
    // Needs the CSRF header like every other write.
    await itUser.agent.post('/api/assets/NB-0048/attachments').field('kind', 'PHOTO').attach('file', PNG, { filename: 'a.png' }).expect(403);

    const file = await itUser.agent.get(`/api/assets/NB-0048/attachments/${up.body.id}/file`).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(file.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
    await employee.agent.get(`/api/assets/NB-0048/attachments/${up.body.id}/file`).expect(403);

    await post(itUser, `/assets/NB-0048/attachments/${up.body.id}/void`, { reason: 'แนบผิดไฟล์' }).expect(201);
    const after = await detail('NB-0048');
    const row = after.attachments.find((a: { id: string }) => a.id === up.body.id);
    expect(row.voidReason).toBe('แนบผิดไฟล์');
    expect(row).not.toHaveProperty('storageKey');
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'asset.attach' } });
    expect(audit?.actorId).toBe(itUser.userId);
  });
});

describe('onboarding', () => {
  let roles: Record<string, string>;
  let spareCode: string;

  beforeAll(async () => {
    roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.key, r.id]));
    spareCode = (await post(itUser, '/assets', { code: 'NB-0049', categoryId: notebook, model: 'IdeaPad Slim 3' }).expect(201)).body.code;
  });

  const newHire = (over: object = {}) => ({
    employeeCode: '0270',
    fullName: 'พนักงาน ใหม่',
    fullNameEn: 'New Hire',
    nickname: 'ใหม่',
    email: 'newhire@pas.test',
    personalEmail: 'newhire.personal@example.com',
    employmentType: 'EMPLOYEE',
    startDate: '2026-09-07',
    roleAssignments: [{ roleId: roles.EMPLOYEE, orgUnitId: null }],
    device: { assetCode: spareCode, kind: 'PRIMARY' },
    ...over,
  });

  let hireId: string;

  it('creates the person, their access, the checklist and hands out the device in one step', async () => {
    const res = await post(itUser, '/employees', newHire()).expect(201);
    hireId = res.body.id;
    const p = (await itUser.agent.get(`/api/employees/${hireId}`).expect(200)).body;
    expect(p).toMatchObject({ employeeCode: '0270', employmentType: 'EMPLOYEE', startDate: '2026-09-07', status: 'ACTIVE' });
    expect(p.devices).toEqual([expect.objectContaining({ code: 'NB-0049', kind: 'PRIMARY', startDate: '2026-09-07', endDate: null })]);
    const tasks = p.cases[0].tasks;
    const byKey = Object.fromEntries(tasks.map((t: { key: string }) => [t.key, t]));
    expect(byKey['pas-login'].status).toBe('DONE');
    expect(byKey.device).toMatchObject({ status: 'DONE', assetCode: 'NB-0049' });
    expect(byKey.email).toMatchObject({ status: 'TODO', dueDate: '2026-09-28' }); // "after 3 weeks"
    expect(byKey.trcloud.status).toBe('TODO');
    expect(p.cases[0].closedOn).toBeNull();

    // The new person can sign in and sees their device.
    const s = await login(app, 'newhire@pas.test');
    expect((await s.agent.get('/api/assets/mine').expect(200)).body.map((m: { code: string }) => m.code)).toEqual(['NB-0049']);
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'employee.create', resourceId: hireId } });
    expect(JSON.stringify(audit?.after)).not.toContain('newhire.personal@example.com');
  });

  it('rejects duplicates and privilege escalation', async () => {
    expect((await post(itUser, '/employees', newHire({ email: 'other@pas.test', device: null })).expect(409)).body.message).toContain('รหัสพนักงาน');
    expect((await post(itUser, '/employees', newHire({ employeeCode: '0271', device: null })).expect(409)).body.message).toContain('อีเมล');
    // IT cannot create someone with Admin powers it does not hold.
    await post(itUser, '/employees', newHire({ employeeCode: '0272', email: 'x@pas.test', device: null, roleAssignments: [{ roleId: roles.ADMIN, orgUnitId: null }] })).expect(403);
    await post(employee, '/employees', newHire({ employeeCode: '0273', email: 'y@pas.test', device: null })).expect(403);
    // A device someone else holds cannot be handed out through the wizard either.
    expect(await prisma.employee.count({ where: { employeeCode: { in: ['0271', '0272', '0273'] } } })).toBe(0);
  });

  it('interns get the intern checklist', async () => {
    const res = await post(admin, '/employees', newHire({ employeeCode: '1050', email: null, employmentType: 'INTERN', endDate: '2027-02-26', institution: 'มหาวิทยาลัยเชียงใหม่', device: null })).expect(201);
    const p = (await admin.agent.get(`/api/employees/${res.body.id}`).expect(200)).body;
    const keys = p.cases[0].tasks.map((t: { key: string }) => t.key);
    expect(keys).not.toContain('trcloud');
    expect(p.cases[0].tasks.find((t: { key: string }) => t.key === 'pas-login').status).toBe('TODO'); // no e-mail yet
    await post(admin, '/employees', newHire({ employeeCode: '1051', email: null, employmentType: 'INTERN', endDate: '2026-01-01', device: null })).expect(400);
  });

  it('completing a system task records the account; no passwords, no duplicate IDs', async () => {
    const p = (await itUser.agent.get(`/api/employees/${hireId}`).expect(200)).body;
    const task = (key: string) => p.cases[0].tasks.find((t: { key: string }) => t.key === key);

    expect((await post(itUser, `/onboarding/tasks/${task('xerox').id}`, { status: 'DONE' }).expect(400)).body.code).toBe('IDENTIFIER_REQUIRED');
    expect((await post(itUser, `/onboarding/tasks/${task('xerox').id}`, { status: 'DONE', identifier: '9270', note: 'password: 1234' }).expect(400)).body.code).toBe('SECRET_NOT_ALLOWED');
    await post(itUser, `/onboarding/tasks/${task('xerox').id}`, { status: 'DONE', identifier: '9270' }).expect(201);

    // Same Xerox ID for somebody else is refused while the first account is live.
    const xerox = (await prisma.externalSystem.findUniqueOrThrow({ where: { key: 'XEROX' } })).id;
    expect((await post(itUser, `/onboarding/employees/${employee.userId}/accounts`, { systemId: xerox, identifier: '9270' }).expect(409)).body.message).toContain('9270');

    for (const key of ['antivirus', 'links']) await post(itUser, `/onboarding/tasks/${task(key).id}`, { status: 'DONE' }).expect(201);
    await post(itUser, `/onboarding/tasks/${task('email').id}`, { status: 'DONE', identifier: 'newhire@pas.test' }).expect(201);
    await post(itUser, `/onboarding/tasks/${task('scan-folder').id}`, { status: 'DONE', identifier: 'NEWHIRE' }).expect(201);
    await post(itUser, `/onboarding/tasks/${task('trcloud').id}`, { status: 'SKIPPED', note: 'รอหัวหน้าทีมอนุมัติ' }).expect(201);

    let after = (await itUser.agent.get(`/api/employees/${hireId}`).expect(200)).body;
    expect(after.cases[0].closedOn).not.toBeNull();
    expect(after.accounts.map((a: { system: { key: string }; identifier: string }) => `${a.system.key}:${a.identifier}`).sort()).toEqual(['EMAIL:newhire@pas.test', 'SCAN_FOLDER:NEWHIRE', 'XEROX:9270']);
    expect((await itUser.agent.get('/api/onboarding/tasks').expect(200)).body.some((t: { employee: { id: string } }) => t.employee.id === hireId)).toBe(false);

    // Re-opening a task re-opens the case; disabling the account frees the ID.
    await post(itUser, `/onboarding/tasks/${task('trcloud').id}`, { status: 'TODO' }).expect(201);
    after = (await itUser.agent.get(`/api/employees/${hireId}`).expect(200)).body;
    expect(after.cases[0].closedOn).toBeNull();
    const xeroxAccount = after.accounts.find((a: { system: { key: string } }) => a.system.key === 'XEROX');
    await patch(itUser, `/onboarding/accounts/${xeroxAccount.id}`, { status: 'DISABLED', date: '2026-09-27' }).expect(200);
    await post(itUser, `/onboarding/employees/${employee.userId}/accounts`, { systemId: xerox, identifier: '9270' }).expect(201);
    await employee.agent.get('/api/onboarding/tasks').expect(403);
  });

  it('extended profile fields are editable; personal e-mail stays out of the audit log', async () => {
    await patch(admin, `/employees/${hireId}`, { endDate: '2026-01-01' }).expect(400);
    await patch(admin, `/employees/${hireId}`, { fullNameEn: 'New Hire Jr.', personalEmail: 'changed@example.com', employmentType: 'CONTRACTOR' }).expect(200);
    const p = (await admin.agent.get(`/api/employees/${hireId}`).expect(200)).body;
    expect(p).toMatchObject({ fullNameEn: 'New Hire Jr.', personalEmail: 'changed@example.com', employmentType: 'CONTRACTOR' });
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'employee.update', resourceId: hireId }, orderBy: { id: 'desc' } });
    expect(JSON.stringify(audit?.after)).not.toContain('changed@example.com');
  });
});

describe('schema guard (IT asset)', () => {
  it('keeps the hand-written partial index and exclusion constraint', async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE indexname = 'onboarding_case_one_open_key'`;
    expect(idx).toHaveLength(1);
    const con = await prisma.$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE conname = 'asset_assignment_no_overlap'`;
    expect(con).toHaveLength(1);
  });
});
