import { INestApplication } from '@nestjs/common';
import { TrcloudClient } from '../src/modules/revenue/trcloud.client';
import { login, prisma, Session, startApp } from './helpers';

/** TRCLOUD itself is faked: every test sets what its endpoints answer. No network. */
let app: INestApplication;
let admin: Session, manager: Session;
const ids: Record<string, string> = {};
let answers: Record<string, Record<string, unknown>[]> = {};
const calls: string[] = [];

const post = (s: Session, path: string, body: object = {}) => s.agent.post(`/api/revenue/trcloud${path}`).set('X-CSRF-Token', s.csrf).send(body);
const revenueOf = async (from: string, to: string) => (await admin.agent.get(`/api/reports/analytics?from=${from}&to=${to}`).expect(200)).body.revenue;
const amountOf = (rev: { customers: { id: string; amount: number }[] }, id: string) => rev.customers.find((c) => c.id === id)?.amount;

beforeAll(async () => {
  app = await startApp();
  [admin, manager] = await Promise.all(['admin', 'manager'].map((u) => login(app, `${u}@pas.test`)));
  const client = app.get(TrcloudClient);
  client.settings = () => ({ baseUrl: 'https://fake', companyId: '1', passkey: 'p', encryptHead: 'h', origin: 'https://fake' });
  client.read = async (group: string, command: string) => {
    calls.push(`${group}/${command}`);
    const rows = answers[group];
    return rows?.length ? { success: 1, result: rows } : { success: 1, empty: true };
  };
  for (const [code, name, taxId] of [
    ['TR1', 'บริษัท ซิงค์หนึ่ง จำกัด', null],
    ['TR2', 'บริษัท ซิงค์สอง จำกัด', '0105500000202'],
  ] as const) {
    ids[code] = (await prisma.customer.create({ data: { code, name, taxId } })).id;
  }
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('TRCLOUD contacts → customers', () => {
  beforeAll(() => {
    answers = {
      contact: [
        { contact_code: 'K1', company_name: 'บจก. ซิงค์หนึ่ง', tax_id: '0105500000101', address: '1 ถนนหนึ่ง' },
        { contact_code: 'K2', company_name: 'บริษัท ซิงค์สอง จำกัด', tax_id: '0105500000999', address: '2 ถนนสอง' },
        { contact_code: 'K9', company_name: 'คู่ค้าที่ไม่มีในระบบ' },
      ],
    };
  });

  it('revenue.write only', async () => {
    await post(manager, '/contacts/preview').expect(403);
  });

  it('preview matches by name (legal form ignored) and shows what would change; nothing is saved', async () => {
    const p = (await post(admin, '/contacts/preview').expect(201)).body;
    const row = (code: string) => p.rows.find((r: { contact: { code: string } }) => r.contact.code === code);
    expect(row('K1')).toMatchObject({ status: 'NAME', customerId: ids.TR1, changes: { code: 'K1', taxId: 'FILL', address: '1 ถนนหนึ่ง' } });
    expect(row('K2')).toMatchObject({ status: 'NAME', customerId: ids.TR2, changes: { code: 'K2', taxId: 'CONFLICT', address: '2 ถนนสอง' } });
    expect(row('K9').status).toBe('UNMATCHED');
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR1 } })).trcloudCode).toBeNull();
  });

  it('apply links codes, fills an empty tax id, keeps a different one (conflict), takes the TRCLOUD address; audited', async () => {
    const r = (await post(admin, '/contacts/apply', { decisions: [] }).expect(201)).body;
    expect(r).toMatchObject({ contacts: 3, unlinked: 1, linked: 2, taxIdFilled: 1, taxIdConflicts: 1, addressUpdated: 2 });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR1 } })).toMatchObject({ trcloudCode: 'K1', taxId: '0105500000101', address: '1 ถนนหนึ่ง' });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR2 } })).toMatchObject({ trcloudCode: 'K2', taxId: '0105500000202', address: '2 ถนนสอง' });
    expect(await prisma.auditEvent.count({ where: { action: 'trcloud.contacts.sync' } })).toBe(1);
    const again = (await post(admin, '/contacts/preview').expect(201)).body;
    expect(again.rows.filter((x: { status: string }) => x.status === 'LINKED')).toHaveLength(2);
  });
});

describe('TRCLOUD invoices → revenue', () => {
  const invoices = (iv1 = 10000) => [
    { doc_no: 'IV-1', doc_date: '05/01/2570', contact_code: 'K1', total_before_vat: iv1 }, //    Buddhist year date
    { doc_no: 'IV-2', doc_date: '2027-01-20', contact_code: 'K2', total_before_vat: '5,000.00' },
    { doc_no: 'IV-3', doc_date: '2027-01-25', contact_code: 'K1', total_before_vat: 3000, status: 'ยกเลิก' }, // cancelled
    { doc_no: 'IV-4', doc_date: '2027-01-28', contact_code: 'K9', total_before_vat: 700 }, //    contact not linked
    { doc_no: 'IV-5', doc_date: '2027-02-01', contact_code: 'K1', total_before_vat: 999 }, //    outside the month
  ];

  it('preview: before-VAT totals, cancelled left out, unlinked contacts listed; nothing is saved', async () => {
    answers.invoice = invoices();
    const p = (await post(admin, '/invoices/preview', { from: '2027-01', to: '2027-01' }).expect(201)).body;
    expect(p).toMatchObject({ documents: 3, cancelled: 1, total: 15700, unmatched: { rows: 1, amount: 700 } });
    expect(await prisma.revenueBatch.count({ where: { source: 'API' } })).toBe(0);
  });

  it('commit: each invoice counts on its own date, linked by contact code', async () => {
    await post(admin, '/invoices/commit', { from: '2027-01', to: '2027-01' }).expect(201);
    const month = await revenueOf('2027-01-01', '2027-01-31');
    expect(amountOf(month, ids.TR1)).toBe(10000);
    expect(amountOf(month, ids.TR2)).toBe(5000);
    expect(month.unmatched).toBe(700);
    const firstTen = await revenueOf('2027-01-01', '2027-01-10'); // dated rows are not spread over the month
    expect(amountOf(firstTen, ids.TR1)).toBe(10000);
    expect(amountOf(firstTen, ids.TR2)).toBeUndefined();
  });

  it('syncing the same month again replaces the previous sync (no double counting)', async () => {
    answers.invoice = invoices(12000);
    await post(admin, '/invoices/commit', { from: '2027-01', to: '2027-01' }).expect(201);
    expect(amountOf(await revenueOf('2027-01-01', '2027-01-31'), ids.TR1)).toBe(12000);
    expect(await prisma.revenueBatch.count({ where: { source: 'API', voidedAt: null } })).toBe(1);
  });

  it('an answer the mapping cannot read stops the sync with a clear message and stores nothing', async () => {
    answers.invoice = [{ doc_no: 'IV-9', doc_date: '2027-03-02', contact_code: 'K1', grand_total: 107 }];
    const r = await post(admin, '/invoices/preview', { from: '2027-03', to: '2027-03' }).expect(502);
    expect(r.body.code).toBe('TRCLOUD_MAPPING');
    expect(r.body.message).toMatch(/grand_total/);
    expect(await prisma.revenueBatch.count({ where: { periodFrom: new Date('2027-03-01T00:00:00Z') } })).toBe(0);
  });

  it('only read commands were ever sent to TRCLOUD', () => {
    expect(new Set(calls)).toEqual(new Set(['contact/search', 'invoice/search']));
  });
});
