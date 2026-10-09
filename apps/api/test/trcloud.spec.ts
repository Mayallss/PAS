import { INestApplication } from '@nestjs/common';
import type { TrcloudCompanyKey } from '../src/config';
import { TrcloudClient } from '../src/modules/revenue/trcloud.client';
import { TrcloudSync } from '../src/modules/revenue/trcloud.sync';
import { login, prisma, Session, startApp } from './helpers';

/** TRCLOUD itself is faked: every test sets what each company's endpoints answer. No network. */
let app: INestApplication;
let admin: Session, manager: Session;
const ids: Record<string, string> = {};
/** company → group → rows */
const answers: Partial<Record<TrcloudCompanyKey, Record<string, Record<string, unknown>[]>>> = { PAS: {}, PC: {} };
let companies: TrcloudCompanyKey[] = ['PAS'];
/** The sync closes every customer not in TRCLOUD: other suites' customers are reopened afterwards. */
let activeBefore: string[] = [];
const calls: string[] = [];
/** The group's own tax id (test/env.ts TRCLOUD_GROUP_TAX_IDS). */
const GROUP_TAX_ID = '0105599999991';

const post = (s: Session, path: string, body: object = {}) => s.agent.post(`/api/revenue/trcloud${path}`).set('X-CSRF-Token', s.csrf).send(body);
const revenueOf = async (from: string, to: string) => (await admin.agent.get(`/api/reports/analytics?from=${from}&to=${to}`).expect(200)).body.revenue;
const amountOf = (rev: { customers: { id: string; amount: number }[] }, id: string) => rev.customers.find((c) => c.id === id)?.amount;
const linksOf = async (customerId: string) =>
  Object.fromEntries((await prisma.customerTrcloudLink.findMany({ where: { customerId } })).map((l) => [l.company, l.contactCode]));
const byLink = (company: TrcloudCompanyKey, contactCode: string) => prisma.customer.findFirst({ where: { trcloudLinks: { some: { company, contactCode } } } });
const contact = (id: string, code: string, organization: string, taxId = '', extra: Record<string, unknown> = {}) => ({
  contact_id: id, title: code, document_number: code, name: '', organization, tax_id: taxId, address: '', contact_type: 'normal', obsolete: '0', ...extra,
});

beforeAll(async () => {
  app = await startApp();
  activeBefore = (await prisma.customer.findMany({ where: { isActive: true }, select: { id: true } })).map((c) => c.id);
  [admin, manager] = await Promise.all(['admin', 'manager'].map((u) => login(app, `${u}@pas.test`)));
  const client = app.get(TrcloudClient);
  client.companies = () => companies;
  client.settings = () => ({ baseUrl: 'https://fake', companyId: '1', passkey: 'p', encryptHead: 'h', origin: 'https://fake' });
  client.read = async (company: TrcloudCompanyKey, group: string, command: string) => {
    calls.push(`${group}/${command}`);
    const rows = answers[company]?.[group];
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
  await prisma.customer.updateMany({ where: { id: { in: activeBefore } }, data: { isActive: true } });
  await app.close();
  await prisma.$disconnect();
});

describe('TRCLOUD contacts → customers (one company)', () => {
  beforeAll(() => {
    // live contact/search shape: #code in title/document_number, company in organization (else name)
    answers.PAS!.contact = [
      { contact_id: '501', title: 'K1', document_number: 'K1', name: 'คุณหนึ่ง', organization: 'บจก. ซิงค์หนึ่ง', tax_id: '0105500000101', address: '1 ถนนหนึ่ง', contact_type: 'normal', obsolete: '0' },
      { contact_id: '502', title: 'K2', document_number: 'K2', name: 'บริษัท ซิงค์สอง จำกัด', organization: '', tax_id: '0105500000999', address: '2 ถนนสอง', contact_type: 'normal', obsolete: '0' },
      contact('509', 'K9', 'ห้างเคเก้าการค้า'),
      contact('510', 'S1', 'บริษัท ซิงค์หนึ่ง จำกัด', '', { contact_type: 'supplier' }), // supplier: never a customer
      contact('511', '', 'ไม่มีรหัส'), //                                                    no #code: skipped
      contact('512', 'G1', 'บริษัท พีซี ในเครือ จำกัด', GROUP_TAX_ID), //                     one of the group's companies: never a customer
    ];
  });

  it('revenue.write only', async () => {
    await post(manager, '/contacts/preview').expect(403);
  });

  it('preview matches by name (legal form ignored) and shows what would change; nothing is saved', async () => {
    const p = (await post(admin, '/contacts/preview').expect(201)).body;
    const row = (code: string) => p.rows.find((r: { contact: { code: string } }) => r.contact.code === code);
    expect(row('K1')).toMatchObject({ company: 'PAS', key: 'PAS:K1', status: 'NAME', action: 'LINK', customerId: ids.TR1, changes: { code: 'K1', name: 'บจก. ซิงค์หนึ่ง', taxId: 'FILL', address: '1 ถนนหนึ่ง' } });
    expect(row('K2')).toMatchObject({ status: 'NAME', action: 'LINK', customerId: ids.TR2, changes: { code: 'K2', name: null, taxId: 'CONFLICT', address: '2 ถนนสอง' } });
    expect(row('K9')).toMatchObject({ status: 'UNMATCHED', action: 'NEW' });
    expect(row('S1')).toBeUndefined();
    expect(row('G1')).toBeUndefined();
    expect(p.skipped.PAS).toMatchObject({ noCode: 1, suppliers: 1, group: 1 });
    expect(await linksOf(ids.TR1)).toEqual({});
    expect(await byLink('PAS', 'K9')).toBeNull();
  });

  it('apply links codes, takes the TRCLOUD code, name and address, fills an empty tax id, keeps a different one (conflict), creates the unmatched contact; audited', async () => {
    const r = (await post(admin, '/contacts/apply', { decisions: [] }).expect(201)).body;
    expect(r).toMatchObject({ contacts: 3, waiting: 0, linked: 2, recoded: 2, created: 1, renamed: 1, taxIdFilled: 1, taxIdConflicts: 1, addressUpdated: 2, needsDecision: 0, removed: 0 });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR1 } })).toMatchObject({ code: 'K1', name: 'บจก. ซิงค์หนึ่ง', taxId: '0105500000101', address: '1 ถนนหนึ่ง' });
    expect(await linksOf(ids.TR1)).toEqual({ PAS: 'K1' });
    expect(await byLink('PAS', 'K9')).toMatchObject({ code: 'K9', name: 'ห้างเคเก้าการค้า', taxId: null, isActive: true });
    expect(await prisma.auditEvent.count({ where: { action: 'customer.create', metadata: { path: ['source'], equals: 'trcloud.contacts' } } })).toBe(1);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR2 } })).toMatchObject({ code: 'K2', taxId: '0105500000202', address: '2 ถนนสอง' });
    expect(await prisma.auditEvent.count({ where: { action: 'trcloud.contacts.sync' } })).toBe(1);
    const again = (await post(admin, '/contacts/preview').expect(201)).body;
    expect(again.rows.filter((x: { status: string }) => x.status === 'LINKED')).toHaveLength(3);
    const status = (await admin.agent.get('/api/revenue/trcloud/status').expect(200)).body;
    expect(status).toMatchObject({ enabled: true, companies: ['PAS'] });
    expect(status.lastContactSync).toMatchObject({ created: 1, linked: 2, renamed: 1, needsDecision: 0 });
  });

  it('a second sync changes nothing and creates no duplicates; "leave alone" (null) skips a new contact', async () => {
    answers.PAS!.contact = [...answers.PAS!.contact, contact('520', 'K20', 'บริษัท เคยี่สิบอินเตอร์ จำกัด')];
    const r = (await post(admin, '/contacts/apply', { decisions: [{ key: 'PAS:K20', customerId: null }] }).expect(201)).body;
    expect(r).toMatchObject({ created: 0, linked: 0, renamed: 0, waiting: 1, unchanged: 3 });
    expect(await byLink('PAS', 'K20')).toBeNull();
    const r2 = (await post(admin, '/contacts/apply', { decisions: [{ key: 'PAS:K20', customerId: 'NEW' }] }).expect(201)).body;
    expect(r2).toMatchObject({ created: 1 });
  });

  it('the customers page syncs when stale; a forced refresh always does', async () => {
    expect((await post(admin, '/refresh', {}).expect(201)).body.ran).toBe(false); // just synced
    expect((await post(admin, '/refresh', { force: true }).expect(201)).body).toMatchObject({ ran: true, lastContactSync: { created: 0 } });
  });

  it('a TRCLOUD customer keeps its TRCLOUD data when edited here; one added by hand may use a Thai code', async () => {
    const body = { code: 'OTHER', name: 'ชื่ออื่น', taxId: null, address: null, accountOwnerId: null, isActive: false };
    await admin.agent.put(`/api/catalog/customers/${ids.TR1}`).set('X-CSRF-Token', admin.csrf).send(body).expect(200);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR1 } })).toMatchObject({ code: 'K1', name: 'บจก. ซิงค์หนึ่ง', isActive: true });
    await admin.agent.post('/api/catalog/customers').set('X-CSRF-Token', admin.csrf).send({ code: 'ข001', name: 'สำนักงานบันทึกมือ' }).expect(201);
  });

  it('not in TRCLOUD: deleted when unused, closed when it has work, internal customers kept; back in TRCLOUD → reopened', async () => {
    const all = answers.PAS!.contact;
    const workCategoryId = (await prisma.workCategory.findFirstOrThrow({ where: { children: { none: {} } } })).id;
    await prisma.engagement.create({ data: { customerId: ids.TR2, workCategoryId } });
    answers.PAS!.contact = all.filter((c) => !['K2', 'K20'].includes(String(c.title)));
    expect((await post(admin, '/contacts/apply', {}).expect(201)).body).toMatchObject({ removed: 2, closed: 1, removalHeld: 0 });
    expect(await byLink('PAS', 'K20')).toBeNull();
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR2 } })).toMatchObject({ isActive: false });
    expect(await prisma.customer.count({ where: { code: 'ข001' } })).toBe(0); // added by hand, not in TRCLOUD, nothing attached: deleted
    expect((await prisma.customer.findUniqueOrThrow({ where: { code: 'A001' } })).isActive).toBe(false); // not in TRCLOUD, has work: closed
    expect((await prisma.customer.findUniqueOrThrow({ where: { code: 'PAS' } })).isActive).toBe(true); // internal (leave / meetings): kept
    answers.PAS!.contact = all.filter((c) => c.title !== 'K20');
    expect((await post(admin, '/contacts/apply', {}).expect(201)).body).toMatchObject({ reopened: 1 });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR2 } })).toMatchObject({ isActive: true, code: 'K2' });
    expect(await linksOf(ids.TR2)).toEqual({ PAS: 'K2' });
  });

  it('an empty answer from TRCLOUD never removes or unlinks customers', async () => {
    const all = answers.PAS!.contact;
    answers.PAS!.contact = [];
    expect((await post(admin, '/contacts/apply', {}).expect(201)).body).toMatchObject({ removed: 0, closed: 0, unlinked: 0 });
    expect(await prisma.customerTrcloudLink.count({ where: { company: 'PAS', contactCode: { in: ['K1', 'K2', 'K9'] }, customer: { isActive: true } } })).toBe(3);
    answers.PAS!.contact = all;
  });
});

describe('TRCLOUD with the group’s other companies', () => {
  beforeAll(() => {
    companies = ['PAS', 'PC'];
    answers.PC!.contact = [
      contact('701', 'P7', 'บริษัท ซิงค์หนึ่ง จำกัด', '0105500000101'), // the same client as PAS:K1 (tax id)
      contact('708', 'P8', 'บริษัท เฉพาะพีซี จำกัด'), //                  only PC has it
      contact('709', 'K9', 'บริษัท พีซีคนละราย จำกัด', '0105500000777'), // same code as PAS:K9, a different client
    ];
  });

  it('one customer per client: PC’s contact joins the PAS customer (code stays PAS’s); PC-only clients become customers; a code PAS already uses gets a suffix', async () => {
    const r = (await post(admin, '/contacts/apply', {}).expect(201)).body;
    expect(r).toMatchObject({ companies: ['PAS', 'PC'], linked: 1, created: 2, removed: 0 });
    expect(await linksOf(ids.TR1)).toEqual({ PAS: 'K1', PC: 'P7' });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR1 } })).toMatchObject({ code: 'K1', name: 'บจก. ซิงค์หนึ่ง' });
    expect(await byLink('PC', 'P8')).toMatchObject({ code: 'P8', name: 'บริษัท เฉพาะพีซี จำกัด' });
    expect(await byLink('PC', 'K9')).toMatchObject({ code: 'K9-2', name: 'บริษัท พีซีคนละราย จำกัด' });
    expect((await byLink('PAS', 'K9'))!.id).not.toBe((await byLink('PC', 'K9'))!.id);
  });

  it('a client that leaves PAS but stays in PC is kept, now named and coded by PC', async () => {
    const pas = answers.PAS!.contact;
    answers.PAS!.contact = pas.filter((c) => c.title !== 'K1');
    expect((await post(admin, '/contacts/apply', {}).expect(201)).body).toMatchObject({ removed: 0, closed: 0, recoded: 1 });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR1 } })).toMatchObject({ code: 'P7', name: 'บริษัท ซิงค์หนึ่ง จำกัด', isActive: true });
    expect(await linksOf(ids.TR1)).toEqual({ PC: 'P7' });
    answers.PAS!.contact = pas;
    await post(admin, '/contacts/apply', {}).expect(201);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: ids.TR1 } })).toMatchObject({ code: 'K1' });
    expect(await linksOf(ids.TR1)).toEqual({ PAS: 'K1', PC: 'P7' });
  });

  it('revenue: the same client billed by PAS and PC is added up, per company; invoices inside the group are not revenue', async () => {
    answers.PAS!.report = [
      { document: 'BL-A1', issue_date: '2027-05-03', contact_id: '501', code: 'K1', before_vat: '1000', vat: '70', after_vat: '1070', status: 'Paid' },
      { document: 'BL-A2', issue_date: '2027-05-04', contact_id: '512', code: 'G1', tax_id: GROUP_TAX_ID, before_vat: '9999', vat: '0', after_vat: '9999', status: 'Paid' },
    ];
    answers.PC!.report = [
      // same document number as PAS's: a different invoice of a different company, never a duplicate
      { document: 'BL-A1', issue_date: '2027-05-10', contact_id: '701', code: 'P7', before_vat: '2500', vat: '175', after_vat: '2675', status: 'Forced Success' },
    ];
    const p = (await post(admin, '/invoices/preview', { from: '2027-05', to: '2027-05' }).expect(201)).body;
    expect(p).toMatchObject({ documents: 2, total: 3500, inGroup: 1 });
    expect(p.byCompany).toEqual([
      { company: 'PAS', documents: 1, total: 1000, cancelled: 0, inGroup: 1 },
      { company: 'PC', documents: 1, total: 2500, cancelled: 0, inGroup: 0 },
    ]);
    await post(admin, '/invoices/commit', { from: '2027-05', to: '2027-05' }).expect(201);
    const may = await revenueOf('2027-05-01', '2027-05-31');
    expect(amountOf(may, ids.TR1)).toBe(3500);
    expect(may.customers.find((c: { id: string }) => c.id === ids.TR1).byCompany).toEqual({ PAS: 1000, PC: 2500 });
    expect(may.byCompany).toMatchObject({ PAS: 1000, PC: 2500 });
  });

  it('a company’s sync never replaces another company’s month', async () => {
    answers.PC!.report = [];
    const r = (await post(admin, '/invoices/commit', { from: '2027-05', to: '2027-05' }).expect(201)).body;
    expect(r).toMatchObject({ unchanged: 1, cleared: 1 }); // PAS unchanged, PC's month cleared
    expect(amountOf(await revenueOf('2027-05-01', '2027-05-31'), ids.TR1)).toBe(1000);
    expect(await prisma.revenueBatch.count({ where: { source: 'API', company: 'PAS', voidedAt: null, periodFrom: new Date('2027-05-01T00:00:00Z') } })).toBe(1);
  });

  afterAll(() => {
    companies = ['PAS'];
  });
});

describe('TRCLOUD invoices → revenue', () => {
  // live report/b3 shape: one row per item line; #code in `code`; before_vat per line
  const code: Record<string, string> = { '501': 'K1', '502': 'K2', '599': 'X99' };
  const iv = (no: string, date: string, contactId: string, beforeVat: number, status = 'Forced Success', taxId = '') => ({
    document: no, issue_date: date, contact_id: contactId, code: code[contactId], tax_id: taxId, contact_type: 'normal',
    before_vat: beforeVat.toFixed(15), vat: (beforeVat * 0.07).toFixed(15), after_vat: (beforeVat * 1.07).toFixed(15), status, doc_type: 'Credit[BL]',
  });
  const invoices = (iv1 = 10000) => [
    iv('IV-1', '2027-01-05', '501', iv1 - 4000),
    iv('IV-1', '2027-01-05', '501', 4000), //              second item line of IV-1
    iv('IV-2', '2027-01-20', '502', 5000, 'Paid'),
    iv('IV-3', '2027-01-25', '501', 3000, 'Cancel'), //   cancelled
    iv('IV-4', '2027-01-28', '599', 700), //               contact not linked to a customer
    iv('IV-5', '2027-02-01', '501', 999), //               outside the month
  ];
  const janBatches = () => prisma.revenueBatch.count({ where: { source: 'API', voidedAt: null, periodFrom: new Date('2027-01-01T00:00:00Z') } });

  it('preview: item lines summed per invoice, before VAT; only Cancel left out; unlinked contacts listed; nothing is saved', async () => {
    answers.PAS!.report = invoices();
    const p = (await post(admin, '/invoices/preview', { from: '2027-01', to: '2027-01' }).expect(201)).body;
    expect(p).toMatchObject({ documents: 3, cancelled: 1, total: 15700, unmatched: { rows: 1, amount: 700 } });
    expect(await janBatches()).toBe(0);
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
    answers.PAS!.report = invoices(12000);
    await post(admin, '/invoices/commit', { from: '2027-01', to: '2027-01' }).expect(201);
    expect(amountOf(await revenueOf('2027-01-01', '2027-01-31'), ids.TR1)).toBe(12000);
    expect(await janBatches()).toBe(1);
  });

  it('one batch per month: an unchanged month is left as is; a month whose invoices were all cancelled is cleared', async () => {
    const batches = () => prisma.revenueBatch.count({ where: { source: 'API' } });
    const before = await batches();
    expect((await post(admin, '/invoices/commit', { from: '2027-01', to: '2027-02' }).expect(201)).body).toMatchObject({ months: 2, unchanged: 1, changed: 1 });
    expect(await batches()).toBe(before + 1); // February is new; January did not change
    expect(amountOf(await revenueOf('2027-02-01', '2027-02-28'), ids.TR1)).toBe(999);
    answers.PAS!.report = invoices(12000).map((r) => (r.document === 'IV-5' ? { ...r, status: 'Cancel' } : r));
    expect((await post(admin, '/invoices/commit', { from: '2027-01', to: '2027-02' }).expect(201)).body).toMatchObject({ unchanged: 1, cleared: 1 });
    expect(amountOf(await revenueOf('2027-02-01', '2027-02-28'), ids.TR1)).toBeUndefined();
    expect(amountOf(await revenueOf('2027-01-01', '2027-01-31'), ids.TR1)).toBe(12000); // January untouched
  });

  it('the timer path rewrites a changed month without a person (no creator, replaced batch voided by nobody)', async () => {
    answers.PAS!.report = invoices(13000);
    const sync = app.get(TrcloudSync) as unknown as { storeMonths: (f: string, t: string, u: null) => Promise<{ changed: number }> };
    expect(await sync.storeMonths('2027-01', '2027-01', null)).toMatchObject({ changed: 1 });
    expect(amountOf(await revenueOf('2027-01-01', '2027-01-31'), ids.TR1)).toBe(13000);
    const jan = await prisma.revenueBatch.findFirstOrThrow({ where: { source: 'API', voidedAt: null, periodFrom: new Date('2027-01-01T00:00:00Z') } });
    expect(jan.createdById).toBeNull();
  });

  it('the timer path stores without a person (no creator) and shows as the last automatic sync', async () => {
    answers.PAS!.report = [];
    await app.get(TrcloudSync).syncInvoices();
    const status = (await admin.agent.get('/api/revenue/trcloud/status').expect(200)).body;
    expect(status.lastInvoiceSync).toMatchObject({ rows: 0, total: 0 });
  });

  it('an answer the mapping cannot read stops the sync with a clear message and stores nothing', async () => {
    answers.PAS!.report = [{ document: 'IV-9', issue_date: '2027-03-02', contact_id: '501', code: 'K1', before_vat: '', vat: '', after_vat: '' }];
    const r = await post(admin, '/invoices/preview', { from: '2027-03', to: '2027-03' }).expect(502);
    expect(r.body.code).toBe('TRCLOUD_MAPPING');
    expect(r.body.message).toMatch(/ยอดก่อน VAT/);
    expect(await prisma.revenueBatch.count({ where: { periodFrom: new Date('2027-03-01T00:00:00Z') } })).toBe(0);
  });

  it('only read commands were ever sent to TRCLOUD', () => {
    expect(new Set(calls)).toEqual(new Set(['contact/search', 'report/b3']));
  });
});
