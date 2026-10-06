import { INestApplication } from '@nestjs/common';
import { login, prisma, Session, startApp } from './helpers';

/** Linking surveyed machines to imported people: the system suggests, IT confirms, normal hand-out rules apply. */
let app: INestApplication;
let itStaff: Session;
let employee: Session;
const stamp = Date.now() % 100000;
const code = (n: number) => `NB-T${stamp}-${n}`;
let personA: string;

const note = (who: string) => `ผู้ใช้ตามแบบสำรวจ 09.69: ${who} — ยังไม่ผูกกับพนักงาน`;
const post = (s: Session, url: string, body: object) => s.agent.post(url).set('X-CSRF-Token', s.csrf).send(body);

beforeAll(async () => {
  app = await startApp();
  [itStaff, employee] = await Promise.all([login(app, 'it@pas.test'), login(app, 'employee@pas.test')]);
  const notebook = await prisma.assetCategory.findUniqueOrThrow({ where: { key: 'NOTEBOOK' } });
  personA = (await prisma.employee.create({ data: { fullName: `ทดสอบ จับคู่${stamp}`, nickname: `จับ${stamp}` } })).id;
  await prisma.asset.createMany({
    data: [
      { code: code(1), categoryId: notebook.id, notes: note(`นางสาว ทดสอบ จับคู่${stamp} (จับ${stamp})`) },
      { code: code(2), categoryId: notebook.id, notes: note(`จับ${stamp}`) },
      { code: code(3), categoryId: notebook.id, notes: note('ว่าง เก็บห้อง Server') },
    ],
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

it('suggests holders from the survey note; only IT may see and apply', async () => {
  await employee.agent.get('/api/assets/holder-suggestions').expect(403);
  const res = await itStaff.agent.get('/api/assets/holder-suggestions').expect(200);
  const rows = Object.fromEntries(res.body.rows.filter((r: { code: string }) => r.code.startsWith(`NB-T${stamp}`)).map((r: { code: string }) => [r.code, r]));
  expect(rows[code(1)]).toMatchObject({ match: { employeeId: personA, how: 'FULL_NAME' }, canAssign: true });
  expect(rows[code(2)]).toMatchObject({ match: { employeeId: personA, how: 'NICKNAME' } });
  expect(rows[code(3)]).toMatchObject({ vacant: true, match: null });
  await post(employee, '/api/assets/holder-suggestions/apply', { startDate: '2026-09-01', items: [{ code: code(1), employeeId: personA }] }).expect(403);
});

it('assigns through the normal rules: 1 person = 1 computer refuses the second machine, the rest still go through', async () => {
  const res = await post(itStaff, '/api/assets/holder-suggestions/apply', {
    startDate: '2026-09-01',
    items: [
      { code: code(1), employeeId: personA },
      { code: code(2), employeeId: personA },
    ],
  }).expect(201);
  expect(res.body.assigned).toBe(1);
  expect(res.body.results[1]).toMatchObject({ code: code(2), ok: false });
  expect(res.body.results[1].message).toContain('1 คนถือได้ 1 เครื่อง');

  const asset = await prisma.asset.findUniqueOrThrow({ where: { code: code(1) }, include: { assignments: true, events: true } });
  expect(asset.assignments).toEqual([expect.objectContaining({ employeeId: personA, kind: 'PRIMARY', endDate: null })]);
  expect(asset.events.map((e) => e.type)).toContain('ASSIGNED');
  expect(asset.notes).toContain('— ผูกกับพนักงานแล้ว');

  const again = await itStaff.agent.get('/api/assets/holder-suggestions').expect(200);
  const codes = again.body.rows.map((r: { code: string }) => r.code);
  expect(codes).not.toContain(code(1));
  expect(codes).toContain(code(2));
  expect(again.body.people.find((p: { id: string }) => p.id === personA).holding).toEqual([code(1)]);
});
