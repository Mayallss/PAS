import { changesFor, planContacts } from './trcloud.sync';
import { isoDate, records, toContact, toDocument } from './trcloud.mapping';

describe('TRCLOUD mapping', () => {
  it('finds the records wherever the answer puts them', () => {
    expect(records({ result: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(records({ body: { x: { a: 1 }, y: { a: 2 } } })).toEqual([{ a: 1 }, { a: 2 }]);
    expect(records({ message: 'ok' })).toEqual([]);
  });

  it('dates: ISO, dd/mm/yyyy and Buddhist years', () => {
    expect(isoDate('2026-09-15 10:00:00')).toBe('2026-09-15');
    expect(isoDate('5/9/2026')).toBe('2026-09-05');
    expect(isoDate('15/09/2569')).toBe('2026-09-15');
    expect(isoDate('2569-09-15')).toBe('2026-09-15');
    expect(isoDate('soon')).toBeNull();
  });

  it('contact: code, name, 13-digit tax id, address', () => {
    expect(toContact({ contact_code: 'C001', company_name: 'บริษัท ก จำกัด', tax_id: '0-1055-56012-34-5', address: ' 1 ถนน  ก ' })).toEqual({
      code: 'C001',
      name: 'บริษัท ก จำกัด',
      taxId: '0105556012345',
      address: '1 ถนน ก',
    });
  });

  it('document: before-VAT amount, cancelled flag, credit notes negative', () => {
    const raw = { doc_no: 'IV-001', doc_date: '2026-09-15', contact_code: 'C001', total_before_vat: '10,000.00', status: 'Cancelled' };
    expect(toDocument(raw)).toEqual({ docNo: 'IV-001', date: '2026-09-15', contactCode: 'C001', contactName: '', amount: 10000, cancelled: true });
    expect(toDocument({ ...raw, status: '' }, -1).amount).toBe(-10000);
  });

  it('a field it cannot find stops the sync and names what it did see', () => {
    expect(() => toDocument({ doc_no: 'IV-1', doc_date: '2026-09-01', contact_code: 'C1', grand_total: 107 })).toThrow(/ยอดก่อน VAT.*grand_total/);
  });
});

describe('contacts → customers', () => {
  const customers = [
    { id: 'a', code: 'A001', name: 'บริษัท ตัวอย่างหนึ่ง จำกัด', taxId: null, trcloudCode: null, address: null },
    { id: 'b', code: 'A002', name: 'บริษัท ตัวอย่างสอง จำกัด', taxId: '0105556000002', trcloudCode: 'C002', address: 'เดิม' },
    { id: 'c', code: 'A003', name: 'ห้างหุ้นส่วน ตัวอย่างสาม', taxId: null, trcloudCode: null, address: null },
  ];
  const contact = (code: string, name: string, taxId: string | null = null, address: string | null = null) => ({ code, name, taxId, address });

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

  it('changes: tax id filled only when empty and unused; a different tax id is a conflict; TRCLOUD address wins', () => {
    expect(changesFor(contact('C001', 'x', '0105556000001', 'ที่อยู่ใหม่'), customers[0], customers)).toEqual({ code: 'C001', taxId: 'FILL', address: 'ที่อยู่ใหม่' });
    expect(changesFor(contact('C002', 'x', '0105556099999', 'เดิม'), customers[1], customers)).toEqual({ code: null, taxId: 'CONFLICT', address: null });
    expect(changesFor(contact('C003', 'x', '0105556000002', null), customers[2], customers).taxId).toBe('CONFLICT'); // used by A002
  });
});
