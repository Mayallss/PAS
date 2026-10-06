import { INestApplication } from '@nestjs/common';
import { login, prisma, Session, startApp } from './helpers';

let app: INestApplication;
let employee: Session, manager: Session, admin: Session;

const post = (s: Session, body: object) => s.agent.post('/api/org-units').set('X-CSRF-Token', s.csrf).send(body);
const patch = (s: Session, id: string, body: object) => s.agent.patch(`/api/org-units/${id}`).set('X-CSRF-Token', s.csrf).send(body);
const del = (s: Session, id: string) => s.agent.delete(`/api/org-units/${id}`).set('X-CSRF-Token', s.csrf);

beforeAll(async () => {
  app = await startApp();
  [employee, manager, admin] = await Promise.all(['employee', 'manager', 'admin'].map((u) => login(app, `${u}@pas.test`)));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('teams (legacy team_table + subTeam_table)', () => {
  it('admins create teams and sub-teams, rename and move them; names are unique per level', async () => {
    const team = (await post(admin, { name: 'ทีมภาษี' }).expect(201)).body;
    const sub = (await post(admin, { name: 'ภาษีบุคคล', parentId: team.id }).expect(201)).body;
    await post(admin, { name: ' ทีมภาษี ' }).expect(409);
    await post(admin, { name: 'ภาษีบุคคล' }).expect(201); // same name at another level is fine

    await patch(admin, sub.id, { name: 'ภาษีบุคคลธรรมดา', managerId: manager.userId }).expect(200);
    const list = (await admin.agent.get('/api/org-units').expect(200)).body as {
      id: string;
      name: string;
      parentId: string | null;
      manager: { id: string } | null;
      childCount: number;
    }[];
    expect(list.find((u) => u.id === sub.id)).toMatchObject({ name: 'ภาษีบุคคลธรรมดา', parentId: team.id, manager: { id: manager.userId } });
    expect(list.find((u) => u.id === team.id)?.childCount).toBe(1);

    await patch(admin, sub.id, { parentId: null }).expect(200); // promote to a top-level team
    await patch(admin, sub.id, { parentId: team.id }).expect(200);
    expect(await prisma.auditEvent.count({ where: { resourceType: 'org_unit', resourceId: sub.id } })).toBe(4);
  });

  it('rejects cycles, inactive managers and non-admins', async () => {
    const top = (await post(admin, { name: 'ทีมทดสอบวงวน' }).expect(201)).body;
    const child = (await post(admin, { name: 'ลูก', parentId: top.id }).expect(201)).body;
    await patch(admin, top.id, { parentId: child.id }).expect(422);
    await patch(admin, top.id, { parentId: top.id }).expect(422);

    const inactive = await prisma.employee.create({ data: { fullName: 'อดีตพนักงาน', status: 'INACTIVE' } });
    await patch(admin, top.id, { managerId: inactive.id }).expect(422);

    await post(employee, { name: 'x' }).expect(403);
    await employee.agent.get('/api/org-units').expect(403);
  });

  it('only empty teams can be deleted', async () => {
    const teamA = await prisma.orgUnit.findFirstOrThrow({ where: { name: 'ทีมบัญชี A' } });
    const res = await del(admin, teamA.id).expect(409);
    expect(res.body.message).toContain('มีพนักงานในทีม');

    const empty = (await post(admin, { name: 'ทีมชั่วคราว' }).expect(201)).body;
    const parent = (await post(admin, { name: 'ทีมแม่ชั่วคราว' }).expect(201)).body;
    await patch(admin, empty.id, { parentId: parent.id }).expect(200);
    await del(admin, parent.id).expect(409); // still has a sub-team
    await del(admin, empty.id).expect(204);
    await del(admin, parent.id).expect(204);
  });
});
