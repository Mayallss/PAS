import ExcelJS from 'exceljs';
import { matchRows, normalizeName, normalizeTaxId, parseAmount, parseRevenueFile, prorate } from './revenue.parser';

async function workbook(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('cell values', () => {
  it('tax id: digits only; 12 digits = leading 0 lost by Excel; anything else is not a tax id', () => {
    expect(normalizeTaxId('0-1055-56012-34-5')).toBe('0105556012345');
    expect(normalizeTaxId(105556012345)).toBe('0105556012345');
    expect(normalizeTaxId('12345')).toBeNull();
    expect(normalizeTaxId('')).toBeNull();
  });

  it('amount: commas, baht sign, accounting negatives, formula results', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('฿ 2,000 บาท')).toBe(2000);
    expect(parseAmount('(500)')).toBe(-500);
    expect(parseAmount({ formula: 'A1*2', result: 300 } as ExcelJS.CellValue)).toBe(300);
    expect(parseAmount('n/a')).toBeNull();
  });
});

describe('parseRevenueFile', () => {
  it('finds Thai or English headers below a title, skips blank and total lines, reports bad rows by number', async () => {
    const buf = await workbook([
      ['รายได้ประจำเดือน กันยายน 2569'],
      [],
      ['เลขประจำตัวผู้เสียภาษี', 'ชื่อบริษัท', 'รายได้'],
      [105556012345, 'บริษัท ตัวอย่าง จำกัด', 15000],
      ['', 'ห้างหุ้นส่วนจำกัด สอง', '2,500.75'],
      [],
      ['0105556099999', '', 100],
      ['0105556088888', 'บริษัท สาม จำกัด', 'ไม่ทราบ'],
      ['', 'รวม', 17500.75],
    ]);
    const f = await parseRevenueFile(buf);
    expect(f.rows).toEqual([
      { rowNo: 4, taxId: '0105556012345', companyName: 'บริษัท ตัวอย่าง จำกัด', amount: 15000 },
      { rowNo: 5, taxId: null, companyName: 'ห้างหุ้นส่วนจำกัด สอง', amount: 2500.75 },
    ]);
    expect(f.problems.map((p) => p.rowNo)).toEqual([7, 8]);
    expect(f.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the same rows give the same hash (a re-saved file is still recognised)', async () => {
    const rows = [['taxid', 'companyname', 'income'], ['0105556012345', 'A', 1]];
    expect((await parseRevenueFile(await workbook(rows))).hash).toBe((await parseRevenueFile(await workbook(rows))).hash);
  });

  it('refuses a file without the needed columns, or that is not Excel', async () => {
    await expect(parseRevenueFile(await workbook([['a', 'b'], [1, 2]]))).rejects.toMatchObject({ response: { code: 'FILE_FORMAT' } });
    await expect(parseRevenueFile(Buffer.from('not a workbook'))).rejects.toMatchObject({ response: { code: 'FILE_FORMAT' } });
  });
});

describe('matching', () => {
  const customers = [
    { id: 'a', code: 'A001', name: 'บริษัท ตัวอย่าง จำกัด', taxId: '0105556012345' },
    { id: 'b', code: 'A002', name: 'ห้างหุ้นส่วนจำกัด สอง', taxId: null },
    { id: 'c', code: 'A003', name: 'Lincoln Trading Co., Ltd.', taxId: null },
    { id: 'd', code: 'A004', name: 'บริษัท ตัวอย่างพลัส จำกัด', taxId: null },
  ];

  it('legal forms and punctuation do not matter; English legal words only as whole words', () => {
    expect(normalizeName('บริษัท ตัวอย่าง จำกัด (มหาชน)')).toBe(normalizeName('ตัวอย่าง'));
    expect(normalizeName('หจก. สอง')).toBe(normalizeName('ห้างหุ้นส่วนจำกัด สอง'));
    expect(normalizeName('ห้างหุ้นส่วน สาม')).toBe(normalizeName('หจก. สาม'));
    expect(normalizeName('LINCOLN TRADING COMPANY LIMITED')).toBe('lincolntrading');
  });

  it('tax id first, then name, otherwise suggestions only — never a guess', () => {
    const m = matchRows(
      [
        { taxId: '0105556012345', companyName: 'ชื่อที่พิมพ์ต่างไป' },
        { taxId: null, companyName: 'หจก. สอง' },
        { taxId: null, companyName: 'Lincoln Trading Company Limited' },
        { taxId: null, companyName: 'บริษัท ตัวอย่างพลัสพลัส จำกัด' },
        { taxId: null, companyName: 'ไม่มีใครรู้จัก' },
      ],
      customers,
    );
    expect(m.map((x) => [x.status, x.customerId])).toEqual([
      ['TAX_ID', 'a'],
      ['NAME', 'b'],
      ['NAME', 'c'],
      ['SUGGESTED', null],
      ['UNMATCHED', null],
    ]);
    expect(m[3].candidates[0].id).toBe('d');
  });

  it('two customers with the same tax id → a person chooses', () => {
    const m = matchRows([{ taxId: '0105556012345', companyName: 'x' }], [...customers, { id: 'z', code: 'Z', name: 'ซ้ำ', taxId: '0105556012345' }]);
    expect(m[0].status).toBe('SUGGESTED');
    expect(m[0].candidates.map((c) => c.id).sort()).toEqual(['a', 'z']);
  });
});

describe('prorate', () => {
  it('splits a period by days; outside the range is 0', () => {
    const q3 = { from: '2026-07-01', to: '2026-09-30' }; // 92 days
    expect(prorate(9200, q3, { from: '2026-07-01', to: '2026-07-31' })).toBeCloseTo(3100);
    expect(prorate(9200, q3, { from: '2026-01-01', to: '2026-12-31' })).toBe(9200);
    expect(prorate(9200, q3, { from: '2026-10-01', to: '2026-10-31' })).toBe(0);
  });
});
