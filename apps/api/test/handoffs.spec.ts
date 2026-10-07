import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { login, prisma, Session, startApp } from './helpers';

/**
 * รับ–ส่งเอกสาร (ex-DELIPAS) against a FAKE monday: global fetch is replaced for api.monday.com,
 * so no test can reach the real board (test/env.ts also overrides the token).
 */
const BOARD = '1862570548';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const STATUS_LABELS = { '0': 'รับเอกสารไม่ครบถ้วน', '1': 'ได้รับเอกสารครบถ้วน/ส่งมอบเอกสารแล้ว', '2': 'ไม่ได้รับเอกสาร/ไม่ได้ส่งมอบเอกสาร', '5': 'รอดำเนินการ' };

interface FakeItem {
  id: string;
  status: string; // label index
  updatedAt: string;
  files: string[];
  signer: string;
}
const items = new Map<string, FakeItem>();
const calls: string[] = [];
let realFetch: typeof fetch;

function itemJson(it: FakeItem) {
  return {
    id: it.id,
    name: `ส่งเอกสาร ${it.id}`,
    updated_at: it.updatedAt,
    board: { id: BOARD },
    parent_item: null,
    group: { id: 'topics', title: 'รอดำเนินการ' },
    column_values: [
      { id: 'dropdown', text: 'บริษัท ตัวอย่าง จำกัด', value: null },
      { id: 'date', text: '2026-09-30', value: null },
      { id: 'single_select_1', text: (STATUS_LABELS as Record<string, string>)[it.status], value: JSON.stringify({ index: Number(it.status) }) },
      { id: 'signature', text: '', value: JSON.stringify({ files: it.files.map((name) => ({ name })) }) },
      { id: 'short_text1', text: 'INV-001', value: null },
      { id: 'short_text3', text: '2', value: null },
    ],
  };
}

async function fakeMonday(url: string, init: RequestInit): Promise<Response> {
  const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/v2/file')) {
    const form = init.body as FormData;
    const id = String(form.get('query')).match(/item_id:(\d+)/)![1];
    const file = form.get('image') as File;
    items.get(id)!.files.push(file.name);
    items.get(id)!.updatedAt = new Date().toISOString();
    calls.push(`upload:${id}`);
    return ok({ add_file_to_column: { id: 'asset-1' } });
  }
  const { query, variables } = JSON.parse(String(init.body));
  if (query.includes('change_multiple_column_values')) {
    const it = items.get(String(variables.item))!;
    const values = JSON.parse(variables.values);
    it.status = String(values.single_select_1.index);
    it.signer = values.text_mm7xtpds;
    calls.push(`status:${it.id}:${it.status}`);
    return ok({ change_multiple_column_values: { id: it.id } });
  }
  const columns = [
    { id: 'dropdown', type: 'dropdown', settings_str: JSON.stringify({ labels: [] }) },
    { id: 'single_select_1', type: 'status', settings_str: JSON.stringify({ labels: STATUS_LABELS }) },
    { id: 'signature', type: 'file', settings_str: '{}' },
    { id: 'text_mm7xtpds', type: 'text', settings_str: '{}' },
    { id: 'text_mm7x9rpf', type: 'text', settings_str: '{}' },
  ];
  if (query.includes('items_page(limit:1')) {
    const it = items.get(String(variables.ids[0]));
    return ok({ boards: [{ columns, items_page: { items: it ? [itemJson(it)] : [] } }] });
  }
  if (query.includes('groups(ids')) {
    calls.push('list');
    const page = { title: 'รอดำเนินการ', items_page: { items: [...items.values()].map(itemJson) } };
    return ok({ boards: [{ name: 'DEV', columns: [{ settings_str: '{"labels":[]}' }], g0: [page], g1: [page], g2: [page], g3: [page] }] });
  }
  return new Response(JSON.stringify({ errors: [{ message: 'unexpected query in test' }] }), { status: 200 });
}

let app: INestApplication;
let employee: Session;

beforeAll(async () => {
  realFetch = global.fetch;
  global.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.monday.com/')) return fakeMonday(url, init ?? {});
    return realFetch(input, init);
  }) as typeof fetch;
  app = await startApp();
  employee = await login(app, 'employee@pas.test');
});

afterAll(async () => {
  global.fetch = realFetch;
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  items.clear();
  calls.length = 0;
  items.set('1001', { id: '1001', status: '5', updatedAt: '2026-09-30T01:00:00Z', files: [], signer: '' });
  items.set('1002', { id: '1002', status: '5', updatedAt: '2026-09-30T01:00:00Z', files: [], signer: '' });
});

const save = (s: Session, body: object) => s.agent.post('/api/handoffs').set('X-CSRF-Token', s.csrf).send(body);

describe('รับ–ส่งเอกสาร (monday hand-over)', () => {
  it('needs a session; lists every tab from one monday request', async () => {
    await request(app.getHttpServer()).get('/api/handoffs').expect(401);
    const res = await employee.agent.get('/api/handoffs?fresh=1').expect(200);
    expect(res.body.groups).toHaveLength(4);
    expect(res.body.groups[2].items[0]).toMatchObject({ id: '1001', customer: 'บริษัท ตัวอย่าง จำกัด', documents: [{ title: 'ใบกำกับภาษี', detail: 'INV-001', quantity: '2' }] });
    expect(calls.filter((c) => c === 'list')).toHaveLength(1);
  });

  it('uploads the signature, then sets status + signer; a retried request is replayed, not applied twice', async () => {
    const { context } = (await employee.agent.get('/api/handoffs/1001').expect(200)).body;
    const body = { itemId: '1001', outcome: '1', name: ' สมชาย ผู้รับ ', signature: PNG, requestId: randomUUID(), context };
    const first = await save(employee, body).expect(201);
    expect(first.body).toMatchObject({ ok: true, replayed: false, status: 'ได้รับเอกสารครบถ้วน/ส่งมอบเอกสารแล้ว' });
    expect(calls).toEqual(['upload:1001', 'status:1001:1']);
    expect(items.get('1001')!.signer).toBe('สมชาย ผู้รับ');

    const again = await save(employee, body).expect(201);
    expect(again.body.replayed).toBe(true);
    expect(calls.filter((c) => c.startsWith('upload'))).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { action: 'handoff.save', resourceId: '1001' } })).toBe(1);
  });

  it('refuses when the ticket changed in monday after it was opened, or the token is forged/for another item', async () => {
    const { context } = (await employee.agent.get('/api/handoffs/1001').expect(200)).body;
    items.get('1001')!.status = '0'; // someone changed it in monday
    const base = { itemId: '1001', outcome: '1', name: 'x', signature: PNG, requestId: randomUUID() };
    expect((await save(employee, { ...base, context }).expect(409)).body.code).toBe('CHANGED_IN_MONDAY');
    expect(calls.some((c) => c.startsWith('upload'))).toBe(false);
    expect((await save(employee, { ...base, context: context.replace(/^./, (c: string) => (c === 'e' ? 'f' : 'e')) }).expect(409)).body.code).toBe('TOKEN_EXPIRED');
    expect((await save(employee, { ...base, itemId: '1002', context }).expect(403)).body.code).toBe('CONTEXT_MISMATCH');
    await save(employee, { ...base, context, signature: 'data:image/jpeg;base64,xxxx' }).expect(400);
  });

  it('a share link lets someone without login see and sign that one ticket only', async () => {
    const share = await employee.agent.post('/api/handoffs/1001/share').set('X-CSRF-Token', employee.csrf).expect(201);
    const url = new URL(share.body.url);
    const token = url.searchParams.get('share')!;
    expect(url.pathname).toBe('/sign');

    const anon = request(app.getHttpServer());
    const detail = await anon.get(`/api/public/handoffs/1001?share=${encodeURIComponent(token)}`).expect(200);
    expect(detail.body.item.id).toBe('1001');
    await anon.get(`/api/public/handoffs/1002?share=${encodeURIComponent(token)}`).expect(403);

    // A normal save token (from an employee opening the ticket) is not a share link.
    const { context: saveToken } = (await employee.agent.get('/api/handoffs/1001').expect(200)).body;
    await anon.get(`/api/public/handoffs/1001?share=${encodeURIComponent(saveToken)}`).expect(409);
    await anon.post('/api/public/handoffs').send({ itemId: '1001', outcome: '0', name: 'ลูกค้า', signature: PNG, requestId: randomUUID(), context: saveToken }).expect(409);

    const done = await anon.post('/api/public/handoffs').send({ itemId: '1001', outcome: '0', name: 'ลูกค้า', signature: PNG, requestId: randomUUID(), context: token }).expect(201);
    expect(done.body.status).toBe('รับเอกสารไม่ครบถ้วน');
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'handoff.save_via_link', resourceId: '1001' } });
    expect(audit?.after).toMatchObject({ signer: 'ลูกค้า', linkCreatedBy: employee.userId });
  });
});
