// Daily Scrum's date window, in the team's time zone (confirmed with the
// user 2026-10-12): "today" is the current date in that zone, the last
// working day is the most recent Monday-Friday before today (Saturday and
// Sunday are the weekend, same as common/business-days.ts), and the
// window runs from 00:00 on that day, in that zone, until now. Working
// hours are shown for information only and never cut the window. No
// holiday calendar. Pure - no Nest/TypeORM imports - so it can be tested
// with a fixed "now". The time zone helpers are shared with the QA Review
// summary (team-settings/time-zone.ts).

import { dateInZone, startOfDayInZone } from '../team-settings/time-zone';

export { TEAM_SETTINGS_DEFAULTS, isValidTimeZone, dateInZone, startOfDayInZone } from '../team-settings/time-zone';

export interface ScrumWindow {
  timeZone: string;
  // YYYY-MM-DD in timeZone.
  today: string;
  lastWorkingDay: string;
  // 00:00 on lastWorkingDay in timeZone, as an instant.
  since: Date;
  generatedAt: Date;
}

// Most recent Monday-Friday strictly before `date` (YYYY-MM-DD).
export function lastWorkingDayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

export function computeScrumWindow(now: Date, timeZone: string): ScrumWindow {
  const today = dateInZone(now, timeZone);
  const lastWorkingDay = lastWorkingDayBefore(today);
  return { timeZone, today, lastWorkingDay, since: startOfDayInZone(lastWorkingDay, timeZone), generatedAt: now };
}
