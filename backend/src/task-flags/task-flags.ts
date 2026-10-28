// Performance Tracking S3 (2026-10-28, decisions from the user) - risk and
// blocker flags on a task, and the needed-by date on dependency tickets.
// Pure - no Nest/TypeORM imports. Everything here applies only while the
// task's project has Performance Tracking switched ON; OFF changes nothing.
//
//  * Risk: a short reason is required; the date it was raised is recorded
//    automatically. A likely new date is optional and for information only
//    - it never changes the committed Due date (that is an S2 request).
//  * Blocker: a reason and a blocking owner - any tracker user, or an
//    outside party typed as text ("external": not charged to any person,
//    and its tasks are reported separately). Optionally linked to one of
//    the task's dependency tickets; filing a ticket never sets a blocker.
//  * At most one open flag of each kind per task. The assignee or any PM/
//    Admin sets either; whoever set it, the assignee or a PM/Admin clears
//    it (and the blocking owner may clear a blocker). Who set it is kept:
//    only flags the assignee set count for D3 (early warning) and O1
//    (blocker raise lag); PM/Admin flags are shown but give no credit.
//  * Open flags clear themselves when the task moves to Pass, Junk, Closed
//    or Released (database trigger).
//  * Dependency needed-by date: set by the ticket's creator when filing it
//    (required while tracking is ON). Only the creator or a PM/Admin can
//    change it, with a reason, and it is logged. The ticket's owner cannot
//    (that would hide their own lateness). Overdue from 00:00 the day after
//    it, in the team's time zone.
import { UserRole } from '../users/user.entity';
import { startOfDayInZone } from '../team-settings/time-zone';

export type TaskFlagKind = 'risk' | 'blocker';
export const TASK_FLAG_KINDS: TaskFlagKind[] = ['risk', 'blocker'];

export const FLAG_MANAGE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

// MUST match the list in tracker_clear_task_flags()
// (migrations/2026-10-performance-tracking-flags.sql) - a test checks.
export const FLAG_CLEARING_STATUSES = ['Pass', 'Junk', 'Closed', 'Released - No Showstoppers', 'Released - With Showstoppers'];

export const FLAG_REASON_MIN = 10;
export const FLAG_TEXT_MAX = 1000;
export const EXTERNAL_OWNER_MAX = 200;

export const TASK_FLAG_AUDIT = {
  SET: 'task_flag_set',
  CLEARED: 'task_flag_cleared',
  DEPENDENCY_NEED_BY_CHANGED: 'task_dependency_ticket_need_by_changed',
} as const;

export interface FlagView {
  kind: TaskFlagKind;
  setByUserId: number;
  blockingOwnerUserId: number | null;
}

export interface FlagPermissions {
  canSetRisk: boolean;
  canSetBlocker: boolean;
}

// What the viewer may do on this task right now.
export function flagPermissions(
  task: { status: string; assigneeUserId: number | null },
  user: { id: number; role: UserRole },
  trackingOn: boolean,
  open: FlagView[],
): FlagPermissions {
  if (!trackingOn || FLAG_CLEARING_STATUSES.includes(task.status)) return { canSetRisk: false, canSetBlocker: false };
  const may = task.assigneeUserId === user.id || FLAG_MANAGE_ROLES.includes(user.role);
  return {
    canSetRisk: may && !open.some((f) => f.kind === 'risk'),
    canSetBlocker: may && !open.some((f) => f.kind === 'blocker'),
  };
}

export function canClearFlag(
  flag: FlagView,
  task: { assigneeUserId: number | null },
  user: { id: number; role: UserRole },
): boolean {
  return (
    flag.setByUserId === user.id ||
    task.assigneeUserId === user.id ||
    FLAG_MANAGE_ROLES.includes(user.role) ||
    (flag.kind === 'blocker' && flag.blockingOwnerUserId === user.id)
  );
}

// Creator or PM/Admin - never the owner alone.
export function canChangeNeedBy(
  ticket: { createdByUserId: number | null; ownerUserId: number },
  user: { id: number; role: UserRole },
): boolean {
  return ticket.createdByUserId === user.id || FLAG_MANAGE_ROLES.includes(user.role);
}

export interface TaskFlagSetEvent {
  tenantId: number;
  taskId: number;
  title: string;
  flagId: number;
  kind: TaskFlagKind;
  reason: string;
  blockingOwnerUserId: number | null;
  actorUserId: number;
  actorEmail: string;
}

// The instant a dependency becomes overdue: 00:00 the day after its
// needed-by date, in the team's time zone.
export function needByOverdueAt(needByDate: string, timeZone: string): Date {
  const next = new Date(`${needByDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return startOfDayInZone(next.toISOString().slice(0, 10), timeZone);
}
