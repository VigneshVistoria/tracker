// Dependency tasks (Option B, decisions from the user 2026-11-05). Pure -
// no Nest/TypeORM imports.
//
// On a project with Project.dependencyTasksEnabled ON (default OFF; Admin
// or Program Manager switches it), a dependency ticket with an internal
// owner also gets a linked task (ProjectTask.dependencyTicketId):
//  * Assigned to the ticket owner, created by the requester (the parent
//    task's assignee), same project / module / phase as the parent.
//  * Due date starts as the requester's needed-by date (when tracking is
//    on); the owner confirms it or sets their own under the normal due-date
//    rules, and it locks. Estimate is the owner's (stored in hours).
//  * Light flow: it is worked in Development (shown as "In progress") and
//    the owner's Resolve moves it straight to Pass - never QA, Peer Review
//    or a PM review. The requester is notified.
//  * The ticket stays the record that blocks the parent. A database trigger
//    (migrations/2026-11-dependency-tasks.sql) keeps it in step with the
//    task's status on every path: Pass / Closed / Released -> resolved,
//    Junk -> cancelled, back to a working status -> open (blocks again).
//  * The task is reassigned only by changing the ticket owner, so the two
//    never disagree.
//  * Left out of KPI, Non-Compliance and Performance Tracking until the
//    user decides (after 2026-11-30). Progress notes work on it even when
//    Performance Tracking is off.
// Existing tickets, and tickets on projects with the switch off, are
// unchanged and have no task.
import { UserRole } from '../users/user.entity';

// MUST match tracker_sync_dependency_ticket() in
// migrations/2026-11-dependency-tasks.sql - a test checks.
export const DEPENDENCY_TASK_RESOLVED_STATUSES = ['Pass', 'Closed', 'Released - No Showstoppers', 'Released - With Showstoppers'];
export const DEPENDENCY_TASK_CANCELLED_STATUS = 'Junk';

export const DEPENDENCY_TASKS_SWITCH_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

export const DEPENDENCY_TASK_AUDIT = {
  PROJECT_SWITCHED: 'dependency_tasks_project_switched',
  TASK_CREATED: 'dependency_task_created',
  TASK_RESOLVED: 'dependency_task_resolved',
  TASK_REASSIGNED: 'dependency_task_reassigned',
} as const;

export function isDependencyTask(task: { dependencyTicketId?: number | null }): boolean {
  return task.dependencyTicketId != null;
}

// Why a dependency task can't take a normal task action, or null.
export function dependencyTaskBlock(task: { id: number; dependencyTicketId?: number | null }, action: 'review' | 'reassign'): string | null {
  if (!isDependencyTask(task)) return null;
  if (action === 'review') {
    return `#${task.id} is a dependency task - it is not reviewed. The owner marks it done with Resolve.`;
  }
  return `#${task.id} is a dependency task - change the owner on its dependency ticket instead.`;
}
