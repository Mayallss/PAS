import { bracketNicknames, norm, suggestHolder, surveyLabel } from './holder-match';

const people = [
  { id: 'a', fullName: 'อนุธิดา ปูดอก', nickname: 'อิ้ง' },
  { id: 'b', fullName: 'พรนภา ปั๋นโตน', nickname: 'กานต์' },
  { id: 'c', fullName: 'พรรษา โห้งแดง', nickname: 'สา' },
  { id: 'd', fullName: 'สมชาย ใจดี', nickname: 'บอล' },
  { id: 'e', fullName: 'สมชาย รักงาน', nickname: 'บอล' },
];

describe('surveyLabel', () => {
  it('reads the user from the imported note', () => {
    expect(surveyLabel('ผู้ใช้ตามแบบสำรวจ 09.69: นางสาว อนุธิดา ปูดอก (อิ้้ง) — ยังไม่ผูกกับพนักงาน\nสถานะ…')).toBe('นางสาว อนุธิดา ปูดอก (อิ้้ง)');
    expect(surveyLabel('ผู้ใช้ตามชีตจอเสริม: สา — ยังไม่ผูกกับพนักงาน')).toBe('สา');
    expect(surveyLabel('ผู้ใช้ตามแบบสำรวจ 09.69: - — ยังไม่ผูกกับพนักงาน')).toBeNull();
    expect(surveyLabel('บันทึกอื่น')).toBeNull();
  });
});

describe('suggestHolder', () => {
  it('matches the full name, ignoring title and spacing', () => {
    expect(suggestHolder('นางสาว อนุธิดา  ปูดอก (อิ้้ง)', people).match).toEqual({ employeeId: 'a', how: 'FULL_NAME' });
  });

  it('matches a nickname written alone, and a nickname with a doubled tone mark', () => {
    expect(suggestHolder('กานต์', people).match).toEqual({ employeeId: 'b', how: 'NICKNAME' });
    expect(norm('อิ้้ง')).toBe(norm('อิ้ง'));
    expect(suggestHolder('คนใหม่ (อิ้้ง)', people).match?.employeeId).toBe('a');
  });

  it('lists candidates instead of guessing when a name is shared', () => {
    const s = suggestHolder('บอล', people);
    expect(s.match).toBeNull();
    expect(s.candidates.map((c) => c.employeeId)).toEqual(['d', 'e']);
    expect(suggestHolder('สมชาย (บอล)', people).match).toBeNull();
  });

  it('marks vacant / shared machines and finds nothing for unknown people', () => {
    expect(suggestHolder('ว่าง เครื่องเก่า ( เก็บห้องServer )', people)).toMatchObject({ vacant: true, match: null });
    expect(suggestHolder('เครื่องสีชมพู - เครื่องเดิมคุณสมิธใช้ (คุณบีเวอร์)', people)).toMatchObject({ vacant: false, match: null, candidates: [] });
  });

  it('offers but does not preselect when a written full name is unknown, or the survey says the person left', () => {
    const other = suggestHolder('นางสาว สาวินี ธงขาว (สา)', people);
    expect(other.match).toBeNull();
    expect(other.candidates).toEqual([{ employeeId: 'c', how: 'NICKNAME' }]);
    expect(suggestHolder('นางสาว พรรษา โห้งแดง(ลาออก) (สา)', people).match).toBeNull();
  });

  it('uses nicknames learned from other survey rows', () => {
    const managers = [{ id: 'm', fullName: 'กรรณพา ยกย่อง', nickname: null }];
    expect(bracketNicknames('นางสาว กรรณพา ยกย่อง (พี่ยู)')).toEqual(['ยู']);
    expect(suggestHolder('พี่ยู', managers).match).toBeNull();
    expect(suggestHolder('พี่ยู', managers, new Map([['m', ['ยู']]])).match).toEqual({ employeeId: 'm', how: 'NICKNAME' });
  });
});
