// Working-day math for the performance metrics, in the team's time zone,
// with editable weekend days and a holiday list. Pure - no Nest/TypeORM
// imports. Kept apart from common/business-days.ts on purpose: that one is
// UTC, Saturday/Sunday only, no holidays, and the QA Review Due Date and
// the PM review wait depend on it staying that way.
import { dateInZone, startOfDayInZone } from '../team-settings/time-zone';

export interface WorkingCalendar {
  timeZone: string;
  // JS day numbers, 0 = Sunday ... 6 = Saturday.
  weekendDays: number[];
  // YYYY-MM-DD.
  holidays: Set<string>;
}

// Ten years of days - a safety stop if a calendar ever had no working day.
const MAX_STEPS = 3660;

export function addCalendarDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isWorkingDay(date: string, cal: WorkingCalendar): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return !cal.weekendDays.includes(dow) && !cal.holidays.has(date);
}

// The `n`th working day after `date` (`date` itself is not counted).
// n = 0 returns `date` itself.
export function addWorkingDays(date: string, n: number, cal: WorkingCalendar): string {
  let result = date;
  let remaining = n;
  for (let step = 0; remaining > 0 && step < MAX_STEPS; step++) {
    result = addCalendarDays(result, 1);
    if (isWorkingDay(result, cal)) remaining -= 1;
  }
  return result;
}

// When a Due date must be set by, for a task assigned at `assignedAt`: the
// end of the `n`th working day after the assignment day, in the team's
// zone. Assigned Monday, n = 1 -> end of Tuesday; Friday -> end of Monday.
// `deadline` is the first instant that is too late (00:00 the next day).
export function commitmentDeadline(assignedAt: Date, n: number, cal: WorkingCalendar): { dueBy: string; deadline: Date } {
  const assignedDay = dateInZone(assignedAt, cal.timeZone);
  const dueBy = addWorkingDays(assignedDay, n, cal);
  return { dueBy, deadline: startOfDayInZone(addCalendarDays(dueBy, 1), cal.timeZone) };
}
