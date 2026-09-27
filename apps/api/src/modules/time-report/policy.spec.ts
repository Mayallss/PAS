import { checkDelete, checkEntry, dayStatus, dayStatusFor, EntryCheck, LEGACY_POLICY, requiredFrom } from './policy';

const base: EntryCheck = {
  policy: LEGACY_POLICY,
  today: '2026-09-27',
  workDate: '2026-09-25',
  durationMinutes: 120,
  otherMinutesSameDay: 0,
  periodLocked: false,
  engagementActive: true,
};
const codes = (c: Partial<EntryCheck>) => checkEntry({ ...base, ...c }).map((v) => v.code);

describe('checkEntry', () => {
  it('accepts a valid entry', () => expect(codes({})).toEqual([]));

  it.each([0, -30, 12.5])('rejects non-positive / non-integer duration %p', (d) => {
    expect(codes({ durationMinutes: d })).toContain('DURATION_INVALID');
  });

  it('enforces the 30-minute increment (legacy step 0.5 h)', () => {
    expect(codes({ durationMinutes: 45 })).toEqual(['DURATION_INCREMENT']);
  });

  it('enforces max 9 h per entry', () => {
    expect(codes({ durationMinutes: 570 })).toEqual(['DURATION_TOO_LONG']);
  });

  it('only warns (no violation) above the daily target when maxDailyMinutes is null — legacy behaviour', () => {
    expect(codes({ durationMinutes: 540, otherMinutesSameDay: 540 })).toEqual([]);
  });

  it('blocks above maxDailyMinutes when configured', () => {
    const policy = { ...LEGACY_POLICY, maxDailyMinutes: 600 };
    expect(codes({ policy, durationMinutes: 120, otherMinutesSameDay: 540 })).toEqual(['DAILY_LIMIT']);
  });

  it('rejects locked periods and inactive engagements', () => {
    expect(codes({ periodLocked: true, engagementActive: false })).toEqual(['PERIOD_LOCKED', 'ENGAGEMENT_INACTIVE']);
  });

  it('allows unlimited backdating by default, limits when configured', () => {
    expect(codes({ workDate: '2020-01-02' })).toEqual([]);
    const policy = { ...LEGACY_POLICY, backdateDays: 7 };
    expect(codes({ policy, workDate: '2026-09-20' })).toEqual([]);
    expect(codes({ policy, workDate: '2026-09-19' })).toEqual(['BACKDATE_LIMIT']);
  });

  it('limits future dates', () => {
    expect(codes({ workDate: '2026-10-28' })).toEqual([]);
    expect(codes({ workDate: '2026-10-29' })).toEqual(['FUTURE_LIMIT']);
  });
});

describe('checkDelete', () => {
  it('blocks delete in locked period', () => {
    expect(checkDelete({ policy: LEGACY_POLICY, today: '2026-09-27', workDate: '2026-09-01', periodLocked: true }).map((v) => v.code)).toEqual(['PERIOD_LOCKED']);
  });
});

describe('dayStatus', () => {
  it('matches the legacy colour thresholds', () => {
    expect(dayStatus(0, 540)).toBe('EMPTY');
    expect(dayStatus(480, 540)).toBe('UNDER');
    expect(dayStatus(540, 540)).toBe('COMPLETE');
    expect(dayStatus(570, 540)).toBe('OVER');
  });
});

describe('dayStatusFor / requiredFrom', () => {
  it('derives the requirement from the schedule and holidays', () => {
    expect(requiredFrom(0, 0)).toBe(0); // weekend in a Mon–Fri schedule
    expect(requiredFrom(540, 540)).toBe(0); // full-day holiday
    expect(requiredFrom(540, 270)).toBe(270); // half-day holiday
    expect(requiredFrom(240, 540)).toBe(0); // part-timer on a full-day holiday
    expect(requiredFrom(480, 0)).toBe(480); // 8-hour schedule
  });

  it('treats non-working days as OFF unless worked', () => {
    expect(dayStatusFor(0, 0)).toBe('OFF');
    expect(dayStatusFor(120, 0)).toBe('COMPLETE');
  });

  it('compares against the reduced requirement on half-day holidays', () => {
    expect(dayStatusFor(270, 270)).toBe('COMPLETE');
    expect(dayStatusFor(540, 270)).toBe('OVER');
    expect(dayStatusFor(0, 540)).toBe('EMPTY');
  });
});
