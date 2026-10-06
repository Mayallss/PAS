import { INestApplication } from '@nestjs/common';
import { login, prisma, Session, startApp } from './helpers';

let app: INestApplication;
let employee: Session, itUser: Session;
const codes = ['LIC-T01', 'LIC-T02', 'LIC-T03', 'LIC-T04'];

const post = (s: Session, path: string, body: object) => s.agent.post(`/api${path}`).set('X-CSRF-Token', s.csrf).send(body);
const patch = (s: Session, path: string, body: object) => s.agent.patch(`/api${path}`).set('X-CSRF-Token', s.csrf).send(body);

beforeAll(async () => {
  app = await startApp();
  [employee, itUser] = await Promise.all(['employee', 'it'].map((u) => login(app, `${u}@pas.test`)));
  const notebook = await prisma.assetCategory.findUniqueOrThrow({ where: { key: 'NOTEBOOK' } });
  for (const code of codes) await prisma.asset.create({ data: { code, categoryId: notebook.id } });
  await prisma.asset.update({ where: { code: 'LIC-T04' }, data: { status: 'DISPOSED' } });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function newLicense(body: object) {
  const sw = (await post(itUser, '/software', { name: `AV ${Math.random().toString(36).slice(2, 7)}`, category: 'แอนตี้ไวรัส' }).expect(201)).body;
  const lic = (await post(itUser, '/licenses', { softwareId: sw.id, name: 'ปี 1', type: 'SUBSCRIPTION', metric: 'PER_DEVICE', ...body }).expect(201)).body;
  return { sw, lic };
}

describe('software licences', () => {
  it('only IT/Admin see and manage licences; a full product key is refused', async () => {
    await employee.agent.get('/api/licenses').expect(403);
    await post(employee, '/software', { name: 'x' }).expect(403);
    const sw = (await post(itUser, '/software', { name: 'Office ทดสอบ', category: 'Office' }).expect(201)).body;
    await post(itUser, '/software', { name: 'Office ทดสอบ' }).expect(409);
    const res = await post(itUser, '/licenses', { softwareId: sw.id, name: 'x', type: 'PERPETUAL', metric: 'PER_DEVICE', keyHint: 'ABCDE-FGHIJ' }).expect(422);
    expect(res.body.code).toBe('KEY_TOO_LONG');
    await post(itUser, '/licenses', { softwareId: sw.id, name: 'x', type: 'SUBSCRIPTION', metric: 'PER_DEVICE', startDate: '2026-01-01', endDate: '2025-01-01' }).expect(422);
  });

  it('assigns machines within the seat count, one active seat per machine, not to disposed machines or by person on a per-device licence', async () => {
    const { lic } = await newLicense({ seats: 2, startDate: '2026-01-01', endDate: '2099-12-31' });
    await post(itUser, `/licenses/${lic.id}/seats`, { assetCodes: ['lic-t01'] }).expect(201);
    expect((await post(itUser, `/licenses/${lic.id}/seats`, { assetCodes: ['LIC-T01'] }).expect(409)).body.code).toBe('ALREADY_ASSIGNED');
    expect((await post(itUser, `/licenses/${lic.id}/seats`, { assetCodes: ['LIC-T02', 'LIC-T03'] }).expect(409)).body.code).toBe('SEATS_FULL');
    expect((await post(itUser, `/licenses/${lic.id}/seats`, { assetCodes: ['LIC-T04'] }).expect(422)).body.code).toBe('ASSET_GONE');
    expect((await post(itUser, `/licenses/${lic.id}/seats`, { employeeIds: [employee.userId] }).expect(422)).body.code).toBe('METRIC_MISMATCH');

    const detail = (await itUser.agent.get(`/api/licenses/${lic.id}`).expect(200)).body;
    expect(detail.used).toBe(1);
    const seat = detail.seatsList[0];
    await post(itUser, `/licenses/${lic.id}/seats/${seat.id}/end`, { note: 'เปลี่ยนเครื่อง' }).expect(201);
    await post(itUser, `/licenses/${lic.id}/seats`, { assetCodes: ['LIC-T02', 'LIC-T03'] }).expect(201); // freed seat reusable
    expect((await patch(itUser, `/licenses/${lic.id}`, { expectedVersion: detail.version, seats: 1 }).expect(422)).body.code).toBe('SEATS_BELOW_USED');

    const onMachine = (await itUser.agent.get('/api/assets/LIC-T01/licenses').expect(200)).body;
    expect(onMachine[0]).toMatchObject({ licenseId: lic.id, endDate: expect.any(String) }); // history kept
  });

  it('an expired licence takes no new seats; renewing carries the machines and closes the old seats', async () => {
    const { lic } = await newLicense({ seats: 5, startDate: '2020-01-01', endDate: '2020-12-31' });
    await prisma.licenseAssignment.create({ data: { licenseId: lic.id, assetId: (await prisma.asset.findUniqueOrThrow({ where: { code: 'LIC-T01' } })).id, startDate: new Date('2020-01-05T00:00:00Z'), createdById: itUser.userId } });
    expect((await post(itUser, `/licenses/${lic.id}/seats`, { assetCodes: ['LIC-T02'] }).expect(422)).body.code).toBe('LICENSE_EXPIRED');

    const next = (await post(itUser, `/licenses/${lic.id}/renew`, { name: 'ปี 2', startDate: '2021-01-01', endDate: '2099-12-31', carrySeats: true }).expect(201)).body;
    expect(next.moved).toBe(1);
    await post(itUser, `/licenses/${lic.id}/renew`, { name: 'ซ้ำ', startDate: '2021-01-01', endDate: '2099-12-31', carrySeats: false }).expect(409);
    const old = (await itUser.agent.get(`/api/licenses/${lic.id}`).expect(200)).body;
    expect(old).toMatchObject({ used: 0, renewedBy: { id: next.id }, state: 'EXPIRED' });
    expect(old.seatsList[0].endDate).toBe('2020-12-31');
    const renewed = (await itUser.agent.get(`/api/licenses/${next.id}`).expect(200)).body;
    expect(renewed).toMatchObject({ used: 1, renewedFrom: { id: lic.id }, seats: 5 });
  });

  it('the overview lists computers in use without an active antivirus seat', async () => {
    const list = (await itUser.agent.get('/api/licenses').expect(200)).body;
    const without = list.overview.withoutAntivirus.map((a: { code: string }) => a.code);
    expect(without).not.toContain('LIC-T01'); // covered by the renewed licence
    expect(without).not.toContain('LIC-T04'); // disposed
  });
});
