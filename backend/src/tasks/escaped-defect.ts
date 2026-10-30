// Performance Tracking Q4 - escaped defects (2026-10-30, fast-track: the
// open rules are settings or defaults listed for the Technical Director in
// /home/ec2-user/perf-tracking-defaults.md).
//
// A defect can be marked "Found in production" by QA, a Program Manager or
// an Admin, on a project with Performance Tracking ON. It records:
//   - the released task it escaped from (optional; without one the defect
//     is listed on the scorecard details but charged to nobody), and
//   - the release date of that work (required). Left empty, it is taken
//     from the source task's Release Log entry (the latest release on or
//     before today); with no Release Log entry it must be entered.
// Unmarking is allowed (a mistake), with the same roles. Every change is
// audited with before/after.
//
// Q4 (metrics/tracking-metrics.ts): defects marked in the window and found
// within escapeWindowDays (30) of their release date, charged to whoever
// submitted the source task's last passing QA round (else its assignee),
// per escapedPerTasks (10) tasks released by the person in the window. A
// task is "released" on its first Release Log date, or the first time it
// moved to a Released status, whichever is earlier.
import { UserRole } from '../users/user.entity';

export const ESCAPED_DEFECT_ROLES: UserRole[] = [UserRole.QA, UserRole.PROGRAM_MANAGER, UserRole.ADMIN];

export const ESCAPED_DEFECT_AUDIT = {
  MARKED: 'defect_found_in_production_updated',
} as const;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A release date may not be after the day the defect was found (a defect
// cannot escape from work not yet live).
export function releaseDateProblem(releaseDate: string, foundOn: string): string | null {
  if (!ISO_DATE.test(releaseDate) || Number.isNaN(Date.parse(`${releaseDate}T00:00:00Z`))) return 'Release date must be a date (YYYY-MM-DD).';
  if (releaseDate > foundOn) return 'The release date cannot be after the day the defect was found.';
  return null;
}
