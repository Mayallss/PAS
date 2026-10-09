import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { login, prisma, Session, startApp } from './helpers';

let app: INestApplication;
let admin: Session, manager: Session, partner: Session;
const ids: Record<string, string> = {};

async function xlsx(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('รายได้');
  ws.addRow(['taxid', 'companyname', 'income']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const preview = (s: Session, file: Buffer) => s.agent.post('/api/revenue/preview').set('X-CSRF-Token', s.csrf).attach('file', file, 'revenue.xlsx');
const commit = (s: Session, file: Buffer, meta: object) =>
  s.agent.post('/api/revenue/batches').set('X-CSRF-Token', s.csrf).field('meta', JSON.stringify(meta)).attach('file', file, 'รายได้-กันยายน.xlsx');
const analytics = (s: Session, from: string, to: string) => s.agent.get(`/api/reports/analytics?from=${from}&to=${to}`);
const revenueOf = (body: { revenue: { customers: { id: string; amount: number }[] } }, id: string) => body.revenue.customers.find((c) => c.id === id)?.amount;

beforeAll(async () => {
  app = await startApp();
  [admin, manager, partner] = await Promise.all(['admin', 'manager', 'partner'].map((u) => login(app, `${u}@pas.test`)));
  for (const [code, name, taxId] of [
    ['REV1', 'บริษัท รายได้หนึ่ง จำกัด', '0105500000011'],
    ['REV2', 'ห้างหุ้นส่วนจำกัด รายได้สอง', null],
    ['REV3', 'บริษัท ลูกค้าใหม่ล่าสุด จำกัด', null],
  ] as const) {
    ids[code] = (await prisma.customer.create({ data: { code, name, taxId } })).id;
  }
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const september = [
  [105500000011, 'ชื่อที่พิมพ์ไม่ตรง', 30000], //            tax id (leading 0 dropped by Excel) → REV1
  ['', 'หจก. รายได้สอง', '12,000.50'], //                   name, legal form ignored → REV2
  ['0105500000033', 'ลูกค้าใหม่', 9000], //                 near REV3 → suggested, a person confirms
  ['', 'บริษัทที่ไม่มีในระบบ', 1000], //                     unmatched, kept for later
  ['', 'รวม', 52000.5], //                                  total line, skipped
];

describe('who may import', () => {
  it('revenue.write (Admin) only', async () => {
    await admin.agent.get('/api/revenue/batches').expect(200);
    await manager.agent.get('/api/revenue/batches').expect(403);
    await partner.agent.get('/api/revenue/batches').expect(403);
    await preview(manager, await xlsx(september)).expect(403);
  });
});

describe('import', () => {
  let file: Buffer;
  let hash: string;
  let firstBatch: string;
  let fixedBatch: string;

  it('preview matches by tax id, then name; suggests; never guesses; stores nothing', async () => {
    file = await xlsx(september);
    const p = (await preview(admin, file).expect(201)).body;
    hash = p.contentHash;
    expect(p.rows.map((r: { match: { status: string; customerId: string | null } }) => [r.match.status, r.match.customerId])).toEqual([
      ['TAX_ID', ids.REV1],
      ['NAME', ids.REV2],
      ['SUGGESTED', null],
      ['UNMATCHED', null],
    ]);
    expect(p.rows[2].match.candidates[0].id).toBe(ids.REV3);
    expect(p.total).toBe(52000.5);
    expect(await prisma.revenueBatch.count({ where: { contentHash: hash } })).toBe(0);
  });

  it('commit re-reads the file: a different file than the one previewed is refused', async () => {
    const other = await xlsx([['', 'อื่น', 1]]);
    await commit(admin, other, { contentHash: hash, periodFrom: '2026-09-01', periodTo: '2026-09-30' }).expect(409);
  });

  it('stores the batch with people’s decisions, remembers the confirmed tax id, keeps unmatched rows, is audited', async () => {
    const r = (
      await commit(admin, file, { contentHash: hash, periodFrom: '2026-09-01', periodTo: '2026-09-30', decisions: [{ rowNo: 4, customerId: ids.REV3 }] }).expect(201)
    ).body;
    firstBatch = r.id;
    expect(r).toMatchObject({ rows: 4, total: 52000.5, unmatched: 1, taxIdsRemembered: 1 });
    expect((await prisma.revenueBatch.findUniqueOrThrow({ where: { id: firstBatch } })).fileName).toBe('รายได้-กันยายน.xlsx'); // Thai name survives multer
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: ids.REV3 } })).taxId).toBe('0105500000033');
    expect(await prisma.auditEvent.count({ where: { action: 'revenue.import', resourceId: firstBatch } })).toBe(1);
    // Next time REV3 matches by tax id without help.
    const again = (await preview(admin, file).expect(201)).body;
    expect(again.rows[2].match).toMatchObject({ status: 'TAX_ID', customerId: ids.REV3 });
    expect(again.duplicate.id).toBe(firstBatch);
  });

  it('report: revenue per customer for the range, pro-rata by days; unmatched shown apart', async () => {
    const month = (await analytics(admin, '2026-09-01', '2026-09-30').expect(200)).body;
    expect(revenueOf(month, ids.REV1)).toBe(30000);
    expect(revenueOf(month, ids.REV2)).toBe(12000.5);
    expect(revenueOf(month, ids.REV3)).toBe(9000);
    expect(month.revenue.unmatched).toBe(1000);
    const half = (await analytics(admin, '2026-09-01', '2026-09-15').expect(200)).body;
    expect(revenueOf(half, ids.REV1)).toBe(15000);
  });

  it('profit only for readers who see every team’s cost', async () => {
    expect((await analytics(manager, '2026-09-01', '2026-09-30').expect(200)).body).toMatchObject({ revenue: null, revenueHidden: 'TEAM_SCOPE' });
    expect((await analytics(partner, '2026-09-01', '2026-09-30').expect(200)).body).toMatchObject({ revenue: null, revenueHidden: 'NO_COST_PERMISSION' });
  });

  it('a corrected file replaces the old batch (voided, not deleted); a row can be matched later', async () => {
    const fixed = await xlsx([[105500000011, 'x', 31000]]);
    const h = (await preview(admin, fixed).expect(201)).body.contentHash;
    const r = (await commit(admin, fixed, { contentHash: h, periodFrom: '2026-09-01', periodTo: '2026-09-30', replaceBatchIds: [firstBatch] }).expect(201)).body;
    fixedBatch = r.id;
    expect(r.replaced).toBe(1);
    const old = await prisma.revenueBatch.findUniqueOrThrow({ where: { id: firstBatch } });
    expect(old.voidedAt).not.toBeNull();
    const month = (await analytics(admin, '2026-09-01', '2026-09-30').expect(200)).body;
    expect(revenueOf(month, ids.REV1)).toBe(31000);
    expect(revenueOf(month, ids.REV2)).toBeUndefined();

    const entry = await prisma.revenueEntry.findFirstOrThrow({ where: { batchId: r.id } });
    await admin.agent.patch(`/api/revenue/entries/${entry.id}`).set('X-CSRF-Token', admin.csrf).send({ customerId: null }).expect(200);
    expect((await analytics(admin, '2026-09-01', '2026-09-30').expect(200)).body.revenue.unmatched).toBe(31000);
    // Voided batches cannot be edited.
    const oldEntry = await prisma.revenueEntry.findFirstOrThrow({ where: { batchId: firstBatch } });
    await admin.agent.patch(`/api/revenue/entries/${oldEntry.id}`).set('X-CSRF-Token', admin.csrf).send({ customerId: ids.REV1 }).expect(409);
  });

  it('void needs a reason and takes the batch out of reports', async () => {
    const active = { id: fixedBatch }; // the corrected September batch (other suites may hold active batches too)
    await admin.agent.post(`/api/revenue/batches/${active.id}/void`).set('X-CSRF-Token', admin.csrf).send({ reason: '' }).expect(400);
    await admin.agent.post(`/api/revenue/batches/${active.id}/void`).set('X-CSRF-Token', admin.csrf).send({ reason: 'ไฟล์ผิดเดือน' }).expect(201);
    expect((await analytics(admin, '2026-09-01', '2026-09-30').expect(200)).body.revenue).toMatchObject({ customers: [], unmatched: 0, batches: 0 });
  });
});
