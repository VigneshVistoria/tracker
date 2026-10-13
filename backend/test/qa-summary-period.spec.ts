import { BadRequestException } from '@nestjs/common';
import { resolveQaSummaryPeriod } from '../src/tasks/qa-summary-period';

// QA Review summary periods (2026-10-13): every preset resolved in the
// team's time zone with a fixed "now", end date included, no database.
describe('QA summary periods', () => {
  const EAT = 'Africa/Addis_Ababa';
  // Tuesday 2026-10-13, 10:00 EAT.
  const NOW = new Date('2026-10-13T07:00:00Z');
  const dates = (period: string, now = NOW, extra: Record<string, string> = {}) => {
    const r = resolveQaSummaryPeriod({ period, ...extra }, now, EAT);
    return [r.fromDate, r.toDate];
  };

  it.each([
    ['today', '2026-10-13', '2026-10-13'],
    ['yesterday', '2026-10-12', '2026-10-12'],
    ['this_week', '2026-10-12', '2026-10-18'],
    ['last_week', '2026-10-05', '2026-10-11'],
    ['this_month', '2026-10-01', '2026-10-31'],
    ['last_month', '2026-09-01', '2026-09-30'],
    ['last_3_months', '2026-07-14', '2026-10-13'],
    ['last_6_months', '2026-04-14', '2026-10-13'],
    ['this_year', '2026-01-01', '2026-12-31'],
    ['last_12_months', '2025-10-14', '2026-10-13'],
  ])('%s = %s to %s', (period, from, to) => {
    expect(dates(period)).toEqual([from, to]);
  });

  it('boundaries are 00:00 team time, the end being the day after the last day', () => {
    const r = resolveQaSummaryPeriod({ period: 'this_month' }, NOW, EAT);
    expect(r.from.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  it('"today" follows the team clock, not UTC', () => {
    // 00:30 EAT on Oct 1 is still Sep 30 in UTC.
    expect(dates('today', new Date('2026-09-30T21:30:00Z'))).toEqual(['2026-10-01', '2026-10-01']);
    expect(dates('this_month', new Date('2026-09-30T21:30:00Z'))).toEqual(['2026-10-01', '2026-10-31']);
    // 23:30 EAT on Sep 30.
    expect(dates('this_month', new Date('2026-09-30T20:30:00Z'))).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('weeks start on Monday, including on a Sunday', () => {
    expect(dates('this_week', new Date('2026-10-18T09:00:00Z'))).toEqual(['2026-10-12', '2026-10-18']);
    expect(dates('this_week', new Date('2026-10-19T09:00:00Z'))).toEqual(['2026-10-19', '2026-10-25']);
  });

  it('crosses year and short-month edges', () => {
    expect(dates('last_month', new Date('2027-01-05T09:00:00Z'))).toEqual(['2026-12-01', '2026-12-31']);
    expect(dates('yesterday', new Date('2027-01-01T09:00:00Z'))).toEqual(['2026-12-31', '2026-12-31']);
    // May 31 - 3 months clamps to Feb 28, so the range starts Mar 1.
    expect(dates('last_3_months', new Date('2027-05-31T09:00:00Z'))).toEqual(['2027-03-01', '2027-05-31']);
    expect(dates('this_month', new Date('2028-02-10T09:00:00Z'))).toEqual(['2028-02-01', '2028-02-29']);
  });

  it('Last 12 months never exceeds the Custom maximum, leap years included', () => {
    for (const iso of ['2026-10-13T09:00:00Z', '2028-03-01T09:00:00Z', '2028-02-29T09:00:00Z']) {
      const [from, to] = dates('last_12_months', new Date(iso));
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
      expect(days).toBeLessThanOrEqual(366);
    }
  });

  it('Custom: dates included, at most 366 days', () => {
    expect(dates('custom', NOW, { from: '2026-10-01', to: '2026-10-01' })).toEqual(['2026-10-01', '2026-10-01']);
    expect(dates('custom', NOW, { from: '2028-01-01', to: '2028-12-31' })).toEqual(['2028-01-01', '2028-12-31']);
    const bad = (extra: Record<string, string>) => () => dates('custom', NOW, extra);
    expect(bad({ from: '2026-01-01', to: '2027-01-02' })).toThrow(BadRequestException);
    expect(bad({ from: '2026-10-10', to: '2026-10-01' })).toThrow(BadRequestException);
    expect(bad({ from: '2026-02-30', to: '2026-03-01' })).toThrow(BadRequestException);
    expect(bad({ from: '2026-10-01T00:00:00Z', to: '2026-10-31' })).toThrow(BadRequestException);
    expect(bad({ from: '2026-10-01' })).toThrow(BadRequestException);
  });

  it('rejects a missing or unknown period', () => {
    expect(() => resolveQaSummaryPeriod({}, NOW, EAT)).toThrow(BadRequestException);
    expect(() => resolveQaSummaryPeriod({ period: 'last30' }, NOW, EAT)).toThrow(BadRequestException);
  });

  it('another team zone moves the boundaries with it', () => {
    const r = resolveQaSummaryPeriod({ period: 'this_month' }, NOW, 'Asia/Kolkata');
    expect(r.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });
});
