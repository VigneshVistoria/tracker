// Per-person working calendar (Performance Tracking B4, 2026-10-30, the
// user's defaults). Pure - no Nest/TypeORM imports.
//
//  * Everyone works the tenant default unless they have their own row:
//    East Africa Time (Africa/Addis_Ababa), 07:30-15:30, Saturday and
//    Sunday off, no country. PM/Admin edit a person's time zone, core
//    hours, weekend days and country (Ethiopia, Somaliland or India).
//  * Not working: weekend days, the tenant-wide holidays (the existing
//    Performance Metrics list), the holidays of the person's country (PM
//    enters them; empty until then), and the person's leave (whole days,
//    entered by PM/Admin).
//  * The metrics count working DAYS with this calendar per person (day
//    boundaries stay in the team's time zone so every metric has the same
//    window), and C1 counts working HOURS in the person's own time zone
//    and core hours.
import { WorkingCalendar, addCalendarDays, isWorkingDay } from '../performance-metrics/working-days';
import { dateInZone, startOfDayInZone } from '../team-settings/time-zone';

export const COUNTRIES = ['ethiopia', 'somaliland', 'india'] as const;
export type Country = (typeof COUNTRIES)[number];
export const COUNTRY_LABEL: Record<Country, string> = { ethiopia: 'Ethiopia', somaliland: 'Somaliland', india: 'India' };
export const LEAVE_MAX_DAYS = 366;

export const WORK_CALENDAR_AUDIT = {
  CALENDAR_SET: 'person_work_calendar_set',
  CALENDAR_RESET: 'person_work_calendar_reset',
  LEAVE_ADDED: 'person_leave_added',
  LEAVE_REMOVED: 'person_leave_removed',
  HOLIDAY_ADDED: 'country_holiday_added',
  HOLIDAY_REMOVED: 'country_holiday_removed',
} as const;

export interface PersonCalendar {
  timeZone: string;
  workStart: string;
  workEnd: string;
  weekendDays: number[];
  country: Country | null;
  // Holidays and leave days together (YYYY-MM-DD).
  daysOff: Set<string>;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Every day from start to end inclusive.
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length <= LEAVE_MAX_DAYS; d = addCalendarDays(d, 1)) out.push(d);
  return out;
}

// For the working-day metrics: the person's weekend and days off, in the
// team's zone (see the header).
export function workingDaysCalendar(person: PersonCalendar, teamTimeZone: string): WorkingCalendar {
  return { timeZone: teamTimeZone, weekendDays: person.weekendDays, holidays: person.daysOff };
}

// Working minutes between two instants: core hours on the person's
// working days, in their own time zone.
export function workingMinutesBetween(from: Date, to: Date, person: PersonCalendar): number {
  if (to.getTime() <= from.getTime()) return 0;
  const cal: WorkingCalendar = { timeZone: person.timeZone, weekendDays: person.weekendDays, holidays: person.daysOff };
  const startMin = minutesOf(person.workStart);
  const endMin = minutesOf(person.workEnd);
  let total = 0;
  const last = dateInZone(to, person.timeZone);
  for (let d = dateInZone(from, person.timeZone), steps = 0; d <= last && steps < 3660; d = addCalendarDays(d, 1), steps++) {
    if (!isWorkingDay(d, cal)) continue;
    const midnight = startOfDayInZone(d, person.timeZone).getTime();
    const open = Math.max(midnight + startMin * 60000, from.getTime());
    const close = Math.min(midnight + endMin * 60000, to.getTime());
    if (close > open) total += (close - open) / 60000;
  }
  return Math.round(total);
}
