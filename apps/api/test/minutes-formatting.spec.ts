import { INestApplication } from '@nestjs/common';
import { login, prisma, Session, startApp } from './helpers';

/** Word-style tools in the minutes editor (2026-10-08): the formatting survives saving, anything else is stripped. */
let app: INestApplication;
let admin: Session;
let employee: Session;

beforeAll(async () => {
  app = await startApp();
  [admin, employee] = await Promise.all([login(app, 'admin@pas.test'), login(app, 'employee@pas.test')]);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

it('saved minutes keep alignment, colours, highlight, size, line spacing and indent; unsafe styles are dropped', async () => {
  const body =
    '<h2 style="text-align: center">รายงานการประชุม</h2>' +
    '<p style="margin-left: 2em; line-height: 1.5">ยื่น <mark style="background-color: #fef08a; color: inherit">15 ต.ค.</mark> ' +
    '<span style="color: #b91c1c; font-size: 18px">ด่วน</span> CO<sub>2</sub> ม.<sup>2</sup></p>' +
    '<p style="position: fixed; text-align: right">ขวา</p>';
  const res = await admin.agent
    .post('/api/meetings')
    .set('X-CSRF-Token', admin.csrf)
    .send({ title: 'ทดสอบรูปแบบ', meetingDate: '2026-10-08', startTime: '09:00', endTime: '10:00', bodyHtml: body })
    .expect(201);
  const saved = (await employee.agent.get(`/api/meetings/${res.body.id}`).expect(200)).body.bodyHtml as string;
  expect(saved).toContain('<h2 style="text-align:center">');
  expect(saved).toContain('style="margin-left:2em;line-height:1.5"');
  expect(saved).toContain('<mark style="background-color:#fef08a;color:inherit">');
  expect(saved).toContain('style="color:#b91c1c;font-size:18px"');
  expect(saved).toContain('CO<sub>2</sub>');
  expect(saved).toContain('<p style="text-align:right">ขวา</p>');
  expect(saved).not.toContain('position');
});
