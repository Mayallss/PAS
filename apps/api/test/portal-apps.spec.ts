import { INestApplication } from '@nestjs/common';
import { login, prisma, Session, startApp } from './helpers';

let app: INestApplication;
let employee: Session, employee2: Session, partner: Session, admin: Session, itUser: Session;

const put = (s: Session, keys: string[]) => s.agent.put('/api/apps/favorites').set('X-CSRF-Token', s.csrf).send({ keys });
const keysOf = async (s: Session) => (await s.agent.get('/api/apps').expect(200)).body as { key: string; isAdmin: boolean; favorite: number | null; kind: string }[];

beforeAll(async () => {
  app = await startApp();
  [employee, employee2, partner, admin, itUser] = await Promise.all(['employee', 'employee2', 'partner', 'admin', 'it'].map((u) => login(app, `${u}@pas.test`)));
});

afterAll(async () => {
  await prisma.appFavorite.deleteMany({});
  await app.close();
  await prisma.$disconnect();
});

describe('sidebar apps', () => {
  it('admin pages show only to people holding one of their permissions, in their own section', async () => {
    const mine = await keysOf(employee);
    expect(mine.some((a) => a.isAdmin)).toBe(false);
    expect(mine.map((a) => a.key)).toEqual(expect.arrayContaining(['time-report', 'meetings', 'it-asset', 'plan']));

    const adminKeys = (await keysOf(admin)).filter((a) => a.isAdmin).map((a) => a.key);
    expect(adminKeys).toEqual(expect.arrayContaining(['admin-customers', 'admin-calendar', 'admin-employees']));

    // IT holds employee.admin + onboarding.manage, not catalog.write / calendar.write — and sees integration status (it fixes connections).
    const itAdmin = (await keysOf(itUser)).filter((a) => a.isAdmin).map((a) => a.key).sort();
    expect(itAdmin).toEqual(['admin-employees', 'admin-integrations', 'admin-onboarding']);
  });

  it('an app needs ANY of its permissions (รายงาน was hidden from Partners with a single permission)', async () => {
    expect((await keysOf(partner)).map((a) => a.key)).toContain('reports'); // report.all.read only
    expect((await keysOf(employee)).map((a) => a.key)).not.toContain('reports');
  });
});

describe('favourites', () => {
  it('saves the pinned apps in the given order, per person', async () => {
    const res = await put(employee, ['meetings', 'time-report', 'it-asset']).expect(200);
    const pinned = (res.body as { key: string; favorite: number | null }[]).filter((a) => a.favorite !== null).sort((a, b) => a.favorite! - b.favorite!);
    expect(pinned.map((a) => a.key)).toEqual(['meetings', 'time-report', 'it-asset']);

    await put(employee, ['it-asset', 'meetings']).expect(200); // reorder + unpin
    const again = (await keysOf(employee)).filter((a) => a.favorite !== null).sort((a, b) => a.favorite! - b.favorite!);
    expect(again.map((a) => a.key)).toEqual(['it-asset', 'meetings']);

    expect((await keysOf(employee2)).some((a) => a.favorite !== null)).toBe(false); // not shared
  });

  it('refuses unknown, hidden and planned apps, too many pins, and writes without CSRF', async () => {
    expect((await put(employee, ['nope']).expect(400)).body.code).toBe('UNKNOWN_APP');
    expect((await put(employee, ['admin-employees']).expect(400)).body.keys).toEqual(['admin-employees']);
    await put(employee, ['hr']).expect(400); // planned module
    await put(employee, Array.from({ length: 13 }, (_, i) => `k${i}`)).expect(400);
    await employee.agent.put('/api/apps/favorites').send({ keys: [] }).expect(403);
    // Nothing changed by the refused calls.
    expect((await keysOf(employee)).filter((a) => a.favorite !== null).map((a) => a.key).sort()).toEqual(['it-asset', 'meetings']);
  });
});
