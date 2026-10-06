import { addMonths, entitlementFor, minutesByYear, overlapProblem, planDays } from './leave-rules';

const vacation = { annualMinutes: 3240, minTenureMonths: 12, appliesTo: [] };
const required = new Map([
  ['2026-11-13', 540], // Fri
  ['2026-11-14', 0], //   Sat
  ['2026-11-15', 0], //   Sun
  ['2026-11-16', 540], // Mon
  ['2026-11-17', 240], // Tue, half-day holiday
]);

describe('entitlementFor', () => {
  const employee = { startDate: '2024-01-01', employmentType: 'EMPLOYEE' as const };

  it('gives the legal default once tenure is reached within the year', () => {
    expect(entitlementFor(vacation, 2026, employee, null)).toBe(3240);
    expect(entitlementFor(vacation, 2026, { ...employee, startDate: '2025-12-31' }, null)).toBe(3240); // reaches 1 year on 2026-12-31
    expect(entitlementFor(vacation, 2026, { ...employee, startDate: '2026-02-01' }, null)).toBe(0);
  });

  it('lets HR override, including more than the default and back to zero', () => {
    expect(entitlementFor(vacation, 2026, { ...employee, startDate: '2026-02-01' }, 1620)).toBe(1620);
    expect(entitlementFor(vacation, 2026, employee, 0)).toBe(0);
  });

  it('returns null when a type has no quota, 0 when it does not apply', () => {
    expect(entitlementFor({ ...vacation, annualMinutes: null, minTenureMonths: 0 }, 2026, employee, null)).toBeNull();
    expect(entitlementFor({ ...vacation, appliesTo: ['EMPLOYEE'] }, 2026, { ...employee, employmentType: 'INTERN' }, null)).toBe(0);
  });

  it('adds months safely at month ends', () => {
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2025-11-30', 3)).toBe('2026-02-28');
  });
});

describe('planDays', () => {
  it('charges only working time: weekend free, half-day holiday charges the rest', () => {
    const r = planDays({ unit: 'DAYS', startDate: '2026-11-13', endDate: '2026-11-17' }, required, 30);
    expect(r).toEqual({ days: [{ date: '2026-11-13', minutes: 540 }, { date: '2026-11-16', minutes: 540 }, { date: '2026-11-17', minutes: 240 }] });
  });

  it('refuses a range with no working day', () => {
    expect(planDays({ unit: 'DAYS', startDate: '2026-11-14', endDate: '2026-11-15' }, required, 30)).toMatchObject({ error: { code: 'NOT_A_WORKING_DAY' } });
  });

  it('hourly leave: one day, in increments, not more than the day requires', () => {
    expect(planDays({ unit: 'HOURS', startDate: '2026-11-16', endDate: '2026-11-16', minutes: 120 }, required, 30)).toEqual({ days: [{ date: '2026-11-16', minutes: 120 }] });
    expect(planDays({ unit: 'HOURS', startDate: '2026-11-16', endDate: '2026-11-16', minutes: 100 }, required, 30)).toMatchObject({ error: { code: 'DURATION_INCREMENT' } });
    expect(planDays({ unit: 'HOURS', startDate: '2026-11-17', endDate: '2026-11-17', minutes: 300 }, required, 30)).toMatchObject({ error: { code: 'DURATION_TOO_LONG' } });
    expect(planDays({ unit: 'HOURS', startDate: '2026-11-16', endDate: '2026-11-17', minutes: 60 }, required, 30)).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(planDays({ unit: 'HOURS', startDate: '2026-11-14', endDate: '2026-11-14', minutes: 60 }, required, 30)).toMatchObject({ error: { code: 'NOT_A_WORKING_DAY' } });
  });
});

describe('overlapProblem', () => {
  const day = [{ date: '2026-11-16', minutes: 240 }];

  it('allows two types to share a day within its working time', () => {
    expect(overlapProblem(day, 'sick', [{ date: '2026-11-16', minutes: 300, typeId: 'personal' }], required)).toBeNull();
  });

  it('refuses the same type twice on a day, and going over the day', () => {
    expect(overlapProblem(day, 'sick', [{ date: '2026-11-16', minutes: 60, typeId: 'sick' }], required)?.code).toBe('LEAVE_SAME_DAY');
    expect(overlapProblem(day, 'sick', [{ date: '2026-11-16', minutes: 360, typeId: 'personal' }], required)?.code).toBe('LEAVE_OVERLAP');
  });
});

it('counts a request over New Year in both years', () => {
  expect(minutesByYear([{ date: '2026-12-31', minutes: 540 }, { date: '2027-01-04', minutes: 540 }])).toEqual(new Map([[2026, 540], [2027, 540]]));
});
