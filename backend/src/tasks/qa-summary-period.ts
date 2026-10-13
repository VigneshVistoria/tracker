import { BadRequestException } from '@nestjs/common';
import { dateInZone, startOfDayInZone } from '../team-settings/time-zone';

// The QA Review summary's Period dropdown, resolved on the server in the
// team's time zone (team_settings), so every viewer gets the same
// boundaries whatever their browser's zone (confirmed with the user
// 2026-10-13). Dates are whole days, end date included: the range runs
// from 00:00 on the first day to 00:00 on the day after the last, team
// time. Weeks start on Monday, same as KPI. "Last N months" is rolling
// and ends today (e.g. Last 3 months on Oct 13 = Jul 14 - Oct 13).
// This week / month / year cover the whole calendar period, same as the
// old "This month".

export const QA_SUMMARY_PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'this_year',
  'last_12_months',
  'custom',
] as const;
export type QaSummaryPeriod = (typeof QA_SUMMARY_PERIODS)[number];

// Longest Custom range, in days - a full year, leap years included.
export const MAX_CUSTOM_DAYS = 366;

export interface ResolvedPeriod {
  period: QaSummaryPeriod;
  timeZone: string;
  // YYYY-MM-DD in timeZone, both included.
  fromDate: string;
  toDate: string;
  // [from, to) as instants, for the queries.
  from: Date;
  to: Date;
}

// Calendar arithmetic on YYYY-MM-DD strings, done in UTC so the server's
// own zone never matters.
function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

// Same day n months away, clamped to the end of a shorter month
// (May 31 - 3 months = Feb 28).
function addMonths(date: string, n: number): string {
  const d = utc(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return ymd(target);
}

function isRealDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(utc(value).getTime()) && ymd(utc(value)) === value;
}

function dateRange(period: QaSummaryPeriod, today: string, from?: string, to?: string): [string, string] {
  const monthStart = `${today.slice(0, 7)}-01`;
  const monday = addDays(today, -((utc(today).getUTCDay() + 6) % 7));
  switch (period) {
    case 'today':
      return [today, today];
    case 'yesterday':
      return [addDays(today, -1), addDays(today, -1)];
    case 'this_week':
      return [monday, addDays(monday, 6)];
    case 'last_week':
      return [addDays(monday, -7), addDays(monday, -1)];
    case 'this_month':
      return [monthStart, addDays(addMonths(monthStart, 1), -1)];
    case 'last_month':
      return [addMonths(monthStart, -1), addDays(monthStart, -1)];
    case 'last_3_months':
      return [addDays(addMonths(today, -3), 1), today];
    case 'last_6_months':
      return [addDays(addMonths(today, -6), 1), today];
    case 'this_year':
      return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
    case 'last_12_months':
      return [addDays(addMonths(today, -12), 1), today];
    case 'custom': {
      if (!isRealDate(from) || !isRealDate(to)) {
        throw new BadRequestException('Custom needs from and to dates (YYYY-MM-DD).');
      }
      if (to < from) throw new BadRequestException('The to date must be on or after the from date.');
      const days = (utc(to).getTime() - utc(from).getTime()) / 86_400_000 + 1;
      if (days > MAX_CUSTOM_DAYS) throw new BadRequestException(`A custom period can be at most ${MAX_CUSTOM_DAYS} days.`);
      return [from, to];
    }
  }
}

export function resolveQaSummaryPeriod(
  query: { period?: string; from?: string; to?: string },
  now: Date,
  timeZone: string,
): ResolvedPeriod {
  const period = query.period as QaSummaryPeriod;
  if (!QA_SUMMARY_PERIODS.includes(period)) {
    throw new BadRequestException(`period must be one of: ${QA_SUMMARY_PERIODS.join(', ')}.`);
  }
  const [fromDate, toDate] = dateRange(period, dateInZone(now, timeZone), query.from, query.to);
  return {
    period,
    timeZone,
    fromDate,
    toDate,
    from: startOfDayInZone(fromDate, timeZone),
    to: startOfDayInZone(addDays(toDate, 1), timeZone),
  };
}
