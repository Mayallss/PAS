import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { login, prisma, Session, startApp } from './helpers';

/** Username + password sign-in (user decision 2026-10-02: the portal must work without Google). */
let app: INestApplication;
let admin: Session;
let employee: Session;
let personId: string;
const stamp = Date.now() % 1_000_000;
const username = `staff.${stamp}`;
const GOOD = 'ม้าลายกินหญ้า-2569';

const agent = () => request.agent(app.getHttpServer());
const pwLogin = (a: ReturnType<typeof agent>, password: string, user = username) => a.post('/api/auth/password-login').send({ username: user, password });

beforeAll(async () => {
  app = await startApp();
  [admin, employee] = await Promise.all([login(app, 'admin@pas.test'), login(app, 'employee@pas.test')]);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'EMPLOYEE' } });
  personId = (await prisma.employee.create({ data: { fullName: 'รหัสผ่าน ทดสอบ', roleAssignments: { create: { roleId: role.id } } } })).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

let token: string;

it('an administrator issues a one-time link; nobody but the employee chooses the password', async () => {
  expect((await request(app.getHttpServer()).get('/api/auth/config').expect(200)).body).toMatchObject({ password: true });
  await employee.agent.post(`/api/employees/${personId}/credential/setup-link`).set('X-CSRF-Token', employee.csrf).send({ username }).expect(403);
  // No legacy username for this person → the admin must give one; bad formats are refused.
  await admin.agent.post(`/api/employees/${personId}/credential/setup-link`).set('X-CSRF-Token', admin.csrf).send({}).expect(400);
  await admin.agent.post(`/api/employees/${personId}/credential/setup-link`).set('X-CSRF-Token', admin.csrf).send({ username: 'ชื่อไทย' }).expect(400);
  const res = await admin.agent.post(`/api/employees/${personId}/credential/setup-link`).set('X-CSRF-Token', admin.csrf).send({ username: username.toUpperCase() }).expect(201);
  expect(res.body.username).toBe(username);
  token = new URL(res.body.url).searchParams.get('token')!;
  const stored = await prisma.localCredential.findUniqueOrThrow({ where: { employeeId: personId } });
  expect(stored.setupTokenHash).not.toContain(token); // only a hash of the token is kept
  expect(stored.passwordHash).toBeNull();
});

it('the employee sets a strong password through the link, is signed in, and the link is burnt', async () => {
  const info = await agent().get(`/api/auth/password-setup?token=${token}`).expect(200);
  expect(info.body).toMatchObject({ username, fullName: 'รหัสผ่าน ทดสอบ' });
  const a = agent();
  expect((await a.post('/api/auth/password-setup').send({ token, password: 'short' }).expect(400)).body.code).toBe('PASSWORD_WEAK');
  expect((await a.post('/api/auth/password-setup').send({ token, password: `${username}-abc` }).expect(400)).body.code).toBe('PASSWORD_WEAK');
  await a.post('/api/auth/password-setup').send({ token, password: GOOD }).expect(204);
  await a.get('/api/auth/me').expect(200);
  await agent().post('/api/auth/password-setup').send({ token, password: GOOD }).expect(410);
  const stored = await prisma.localCredential.findUniqueOrThrow({ where: { employeeId: personId } });
  expect(stored.passwordHash).toMatch(/^scrypt\$16\$8\$2\$/);
  expect(stored.passwordHash).not.toContain(GOOD);
});

it('wrong username and wrong password look the same; the right one signs in', async () => {
  const wrong = await pwLogin(agent(), 'not-the-password').expect(401);
  const unknown = await pwLogin(agent(), GOOD, 'nobody.here').expect(401);
  expect(wrong.body.message).toBe(unknown.body.message);
  const a = agent();
  await pwLogin(a, GOOD, `  ${username.toUpperCase()} `).expect(204);
  expect((await a.get('/api/auth/me').expect(200)).body.user.id).toBe(personId);
});

it('locks the account after 5 wrong passwords; an administrator can unlock', async () => {
  for (let i = 0; i < 5; i++) await pwLogin(agent(), `wrong-${i}-password`).expect(401);
  expect((await pwLogin(agent(), GOOD).expect(423)).body.code).toBe('LOCKED');
  expect((await admin.agent.get(`/api/employees/${personId}/credential`).expect(200)).body).toMatchObject({ locked: true, hasPassword: true, username });
  await admin.agent.post(`/api/employees/${personId}/credential/unlock`).set('X-CSRF-Token', admin.csrf).expect(204);
  await pwLogin(agent(), GOOD).expect(204);
});

it('changing the password signs out the other browsers, keeps this one', async () => {
  const other = agent();
  await pwLogin(other, GOOD).expect(204);
  const me = agent();
  await pwLogin(me, GOOD).expect(204);
  const csrf = (await me.get('/api/auth/me').expect(200)).body.csrfToken;
  await me.post('/api/auth/password').set('X-CSRF-Token', csrf).send({ current: 'wrong', next: 'อีกรหัสหนึ่ง-2570' }).expect(400);
  await me.post('/api/auth/password').set('X-CSRF-Token', csrf).send({ current: GOOD, next: 'อีกรหัสหนึ่ง-2570' }).expect(204);
  await me.get('/api/auth/me').expect(200);
  await other.get('/api/auth/me').expect(401);
  await pwLogin(agent(), GOOD).expect(401);
  await pwLogin(agent(), 'อีกรหัสหนึ่ง-2570').expect(204);
});

it('people who left cannot sign in; removing password sign-in ends their sessions', async () => {
  await prisma.employee.update({ where: { id: personId }, data: { status: 'INACTIVE' } });
  await pwLogin(agent(), 'อีกรหัสหนึ่ง-2570').expect(401);
  await prisma.employee.update({ where: { id: personId }, data: { status: 'ACTIVE' } });
  const a = agent();
  await pwLogin(a, 'อีกรหัสหนึ่ง-2570').expect(204);
  await admin.agent.delete(`/api/employees/${personId}/credential`).set('X-CSRF-Token', admin.csrf).expect(204);
  await a.get('/api/auth/me').expect(401);
  await pwLogin(agent(), 'อีกรหัสหนึ่ง-2570').expect(401);
});
