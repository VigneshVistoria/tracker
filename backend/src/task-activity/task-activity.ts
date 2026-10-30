// Performance Tracking B1 (2026-10-30, fast-track plan approved by the
// user) - the Chase button (O3 "Chase only") and the assignee's progress
// note (C5). Pure - no Nest/TypeORM imports. Everything here applies only
// while the task's project has Performance Tracking switched ON; OFF
// changes nothing and the task page shows neither card.
//
//  * Chase: someone waiting on the task asks its assignee for an update.
//    Who may chase is a setting (chaseRoles, default every internal role);
//    never the assignee, never a client, and only someone who can see the
//    task. The assignee is told in-app (email is not configured). One
//    Chase per task per person within chaseCooldownHours (default 24) so
//    repeated clicks don't inflate O3. Each Chase is logged with who was
//    chased (the assignee at that moment) - O3 counts these.
//  * Progress note: the assignee only (C5 counts only the assignee's
//    updates - decided 2026-10-28), at least progressNoteMin characters
//    (default 20). Kept forever, shown newest first on the task page.
//  * Neither works once the task is Pass, Junk, Closed or Released (the
//    same list that clears flags) or has no assignee.
import { UserRole } from '../users/user.entity';
import { FLAG_CLEARING_STATUSES } from '../task-flags/task-flags';

export const ACTIVITY_CLOSED_STATUSES = FLAG_CLEARING_STATUSES;
export const ACTIVITY_TEXT_MAX = 2000;

export const TASK_ACTIVITY_AUDIT = {
  CHASED: 'task_chased',
  PROGRESS_NOTE_ADDED: 'task_progress_note_added',
} as const;

const HOUR_MS = 60 * 60 * 1000;

export interface ActivityTask {
  status: string;
  assigneeUserId: number | null;
}

export interface ActivityUser {
  id: number;
  role: UserRole;
}

// Why the viewer can't chase right now, or null if they can.
export function chaseBlockedReason(
  task: ActivityTask,
  user: ActivityUser,
  chaseRoles: UserRole[],
  lastChaseByUserAt: Date | null,
  cooldownHours: number,
  now: Date,
): string | null {
  if (ACTIVITY_CLOSED_STATUSES.includes(task.status)) return `The task is ${task.status} - it can no longer be chased.`;
  if (!task.assigneeUserId) return 'The task has no assignee to chase.';
  if (task.assigneeUserId === user.id) return 'You cannot chase your own task.';
  if (user.role === UserRole.CLIENT || !chaseRoles.includes(user.role)) return 'Your role cannot chase tasks.';
  if (lastChaseByUserAt && cooldownHours > 0) {
    const next = new Date(lastChaseByUserAt.getTime() + cooldownHours * HOUR_MS);
    if (now < next) return `You already chased this task in the last ${cooldownHours} hours.`;
  }
  return null;
}

export function noteBlockedReason(task: ActivityTask, user: ActivityUser): string | null {
  if (ACTIVITY_CLOSED_STATUSES.includes(task.status)) return `The task is ${task.status} - progress notes are closed.`;
  if (task.assigneeUserId !== user.id) return 'Only the assignee can add a progress note.';
  return null;
}

export interface TaskChasedEvent {
  tenantId: number;
  taskId: number;
  title: string;
  chaseId: number;
  assigneeUserId: number;
  note: string | null;
  actorUserId: number;
  actorEmail: string;
}
