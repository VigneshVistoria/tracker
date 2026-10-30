// Performance Tracking C3 - weekly status report (2026-10-30, the user's
// decisions: a per-person "Submit my weekly report" form; deadline default
// Thursday 17:00 East Africa Time, editable; the auto-generated Weekly
// Reports page is a different thing). Pure - no Nest/TypeORM imports.
//
//  * Developer, Designer and DevOps submit their own report for a week
//    (Monday-Sunday): done this week, plan for next week, blockers
//    (optional). Done and plan need weeklyReportMinLength (20) characters.
//  * The deadline is that week's weeklyReportDeadlineDay (4 = Thursday) at
//    weeklyReportDeadlineTime (17:00) in the team's time zone.
//  * The FIRST submission time is kept and judged against the deadline;
//    the text can be edited afterwards (this week and last week only).
//  * PM, Executive and Admin see everyone's; QA and clients nothing.
//  * Everything only while some project has Performance Tracking ON.
//  * C3 (metrics/tracking-metrics.ts) = weeks whose deadline passed in the
//    window (not on the person's leave/holiday/weekend) submitted on time,
//    as a %. One week is enough data (4 deadlines fit a 28-day window).
import { UserRole } from '../users/user.entity';
import { addCalendarDays } from '../performance-metrics/working-days';
import { startOfDayInZone } from '../team-settings/time-zone';

export const WEEKLY_STATUS_TEAM_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];

export const WEEKLY_STATUS_AUDIT = {
  SUBMITTED: 'weekly_status_submitted',
  UPDATED: 'weekly_status_updated',
} as const;

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// The Monday of the week holding `day` (YYYY-MM-DD).
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addCalendarDays(day, -((dow + 6) % 7));
}

// The deadline instant for the week starting `monday`: deadlineDay (0 =
// Sunday ... 6 = Saturday, in that Monday-Sunday week) at HH:MM in `zone`.
export function weeklyDeadline(monday: string, deadlineDay: number, time: string, zone: string): Date {
  const offset = (deadlineDay + 6) % 7;
  const [h, m] = time.split(':').map(Number);
  return new Date(startOfDayInZone(addCalendarDays(monday, offset), zone).getTime() + (h * 60 + m) * 60 * 1000);
}

export type WeekStatus = 'on_time' | 'late' | 'missing' | 'not_due' | 'waiting';

export function weekStatus(submittedAt: Date | null, deadline: Date, now: Date): WeekStatus {
  if (submittedAt) return submittedAt.getTime() <= deadline.getTime() ? 'on_time' : 'late';
  return now.getTime() > deadline.getTime() ? 'missing' : 'waiting';
}
