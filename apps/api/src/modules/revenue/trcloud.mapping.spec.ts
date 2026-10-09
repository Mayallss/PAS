import { changesFor, codeOf, planContacts, uniqueCode } from './trcloud.sync';
import { isoDate, records, toContact, toDocument, type TrContact } from './trcloud.mapping';

/** Shapes as returned by the live API (contact/search, report/b3) — names and numbers here are made up. */
const contactRaw = (over: Record<string, unknown> = {}) => ({
  contact_id: '12001',
  title: 'PC001',
  document_number: 'PC001',
  name: 'คุณผู้ติดต่อ',
  organization: 'บริษัท ก จำกัด',
  tax_id: '0105556012345',
  address: ' 1 ถนน  ก ',
  contact_type: 'normal',
  obsolete: '0',
  ...over,
});
/** report/b3: one item line of an invoice */
const invoiceRaw = (over: Record<string, unknown> = {}) => ({
  contact_id: '12001',
  contact_type: 'normal',
  code: 'ก001',
  organization: 'บริษัท ก จำกัด',
  tax_id: '0105556012345',
  document: 'BL20260001',
  issue_date: '2026-09-15',
  quantity: '2',
  price: '5000',
  before_vat: '10000.000000000000000',
  vat: '700.00000000000000000',
  after_vat: '10700.000000000000000',
  status: 'Forced Success',
  doc_type: 'Credit[BL]',
  ...over,
});

describe('TRCLOUD mapping (live field names)', () => {
  it('finds the records wherever the answer puts them', () => {
    expect(records({ result: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(records({ body: { x: { a: 1 }, y: { a: 2 } } })).toEqual([{ a: 1 }, { a: 2 }]);
    expect(records({ message: 'ok' })).toEqual([]);
  });

  it('dates: ISO, dd/mm/yyyy and Buddhist years', () => {
    expect(isoDate('2026-09-15 10:00:00')).toBe('2026-09-15');
    expect(isoDate('15/09/2569')).toBe('2026-09-15');
    expect(isoDate('soon')).toBeNull();
  });

  it('contact: #code = document_number, company name from organization (else name), supplier / obsolete flags', () => {
    expect(toContact(contactRaw())).toEqual({ id: '12001', code: 'PC001', name: 'บริษัท ก จำกัด', taxId: '0105556012345', address: '1 ถนน ก', supplier: false, obsolete: false });
    expect(toContact(contactRaw({ organization: '', name: 'นาย ข' }))!.name).toBe('นาย ข');
    expect(toContact(contactRaw({ contact_type: 'supplier', obsolete: '1' }))).toMatchObject({ supplier: true, obsolete: true });
  });

  it('a contact without a #code is skipped (null), not an error', () => {
    expect(toContact(contactRaw({ title: '', document_number: '' }))).toBeNull();
  });

  it('invoice line: before_vat; contact by #code (and contact_id); only "Cancel" is cancelled', () => {
    expect(toDocument(invoiceRaw())).toEqual({ docNo: 'BL20260001', date: '2026-09-15', contactId: '12001', contactCode: 'ก001', contactName: 'บริษัท ก จำกัด', taxId: '0105556012345', amount: 10000, cancelled: false });
    expect(toDocument(invoiceRaw({ status: 'Cancel' })).cancelled).toBe(true);
    expect(toDocument(invoiceRaw({ status: 'Paid' })).cancelled).toBe(false);
    expect(toDocument(invoiceRaw({ before_vat: '' })).amount).toBe(10000); // after_vat − vat
    expect(toDocument(invoiceRaw(), -1).amount).toBe(-10000);
  });

  it('missing amounts stop the sync and name what was there (never imported as 0)', () => {
    expect(() => toDocument(invoiceRaw({ before_vat: '', vat: '', after_vat: '' }))).toThrow(/ยอดก่อน VAT.*document/);
  });
});

describe('contacts → customers', () => {
  const customers = [
    { id: 'a', code: 'A001', name: 'บริษัท ตัวอย่างหนึ่ง จำกัด', taxId: null, trcloudCode: null, address: null, isActive: true },
    { id: 'b', code: 'C002', name: 'บริษัท ตัวอย่างสอง จำกัด', taxId: '0105556000002', trcloudCode: 'C002', address: 'เดิม', isActive: false },
    { id: 'c', code: 'A003', name: 'ห้างหุ้นส่วน ตัวอย่างสาม', taxId: null, trcloudCode: null, address: null, isActive: true },
  ];
  const contact = (code: string, name: string, taxId: string | null = null, address: string | null = null): TrContact => ({ id: `id-${code}`, code, name, taxId, address, supplier: false, obsolete: false });

  it('already linked by code first; then tax id / name; never re-links a linked customer automatically', () => {
    const plan = planContacts(
      [contact('C002', 'ชื่อเปลี่ยนไปแล้ว'), contact('C001', 'บจก. ตัวอย่างหนึ่ง'), contact('C009', 'บริษัท ตัวอย่างสอง จำกัด'), contact('C077', 'ไม่มีในระบบ')],
      customers,
    );
    expect(plan.map((p) => [p.contact.code, p.status, p.customerId])).toEqual([
      ['C002', 'LINKED', 'b'],
      ['C001', 'NAME', 'a'],
      ['C009', 'SUGGESTED', null], // A002 already holds C002
      ['C077', 'UNMATCHED', null],
    ]);
  });

  it('two contacts on one customer → a person decides', () => {
    const plan = planContacts([contact('X1', 'ตัวอย่างสาม'), contact('X2', 'หจก. ตัวอย่างสาม')], customers);
    expect(plan.map((p) => p.status)).toEqual(['SUGGESTED', 'SUGGESTED']);
    expect(plan[0].candidates[0].id).toBe('c');
  });

  it('changes: our code = TRCLOUD code; TRCLOUD name, address and active state win; tax id filled only when empty and unused, else a conflict', () => {
    expect(changesFor(contact('C001', 'บจก. ตัวอย่างหนึ่ง', '0105556000001', 'ที่อยู่ใหม่'), customers[0], customers)).toEqual({ code: 'C001', customerCode: 'C001', name: 'บจก. ตัวอย่างหนึ่ง', activate: false, taxId: 'FILL', address: 'ที่อยู่ใหม่' });
    expect(changesFor(contact('C002', 'บริษัท ตัวอย่างสอง จำกัด', '0105556099999', 'เดิม'), customers[1], customers)).toEqual({ code: null, customerCode: null, name: null, activate: true, taxId: 'CONFLICT', address: null });
    expect(changesFor(contact('C003', 'x', '0105556000002', null), customers[2], customers).taxId).toBe('CONFLICT'); // used by A002
  });
});

describe('customer code', () => {
  const c = (code: string, id = '7'): TrContact => ({ id, code, name: 'x', taxId: null, address: null, supplier: false, obsolete: false });
  it('is the TRCLOUD code as is (Thai kept, spaces → -), unique against codes added by hand', () => {
    expect(codeOf(c('ก001'))).toBe('ก001');
    expect(codeOf(c(' ลค 01 '))).toBe('ลค-01');
    const taken = new Set(['ก001']);
    expect(uniqueCode('ก001', taken)).toBe('ก001-2');
    expect(uniqueCode('ก001', taken)).toBe('ก001-3');
    expect(uniqueCode('ก002', taken)).toBe('ก002');
  });
});
