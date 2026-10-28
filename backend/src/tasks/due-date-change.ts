// Performance Tracking S2 (2026-10-28, decisions from the user) - the
// committed Due date and its change requests. Pure - no Nest/TypeORM
// imports. Only applies while the task's project has Performance Tracking
// switched ON; OFF keeps today's rules exactly (the assignee's first Due
// date locks, Program Manager edits it freely).
//
// With tracking ON:
//  * The first Due date the assignee sets is the commitment and locks.
//  * A reassigned task keeps its date; the new assignee gets ONE free set
//    or confirmation (as does an assignee whose date a PM set), then it
//    locks. Reassignment cancels any pending request.
//  * To change a committed date the assignee asks, with a reason. Any
//    Program Manager or Admin approves or rejects (a rejection needs a
//    note). The old date stays until it is approved. An earlier date needs
//    approval too.
//  * A Program Manager or Admin may change the date directly, with a
//    reason - logged as an approved change. Not on a task assigned to
//    themselves: there they ask like any assignee, and ANOTHER PM/Admin
//    decides. Nobody approves or rejects their own request.
//  * A pending request is cancelled when the task is reassigned or moves
//    to Pass, Junk, Hold, Closed or Released (database trigger).
import { UserRole } from '../users/user.entity';

export const DUE_DATE_DECIDE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

// MUST match the list in tracker_cancel_due_date_requests()
// (migrations/2026-10-performance-tracking-due-date-commitment.sql) - a
// test checks.
export const DUE_DATE_FROZEN_STATUSES = ['Pass', 'Junk', 'Hold', 'Closed', 'Released - No Showstoppers', 'Released - With Showstoppers'];

export const DUE_DATE_REASON_MIN = 10;
export const DUE_DATE_REASON_MAX = 1000;

export const DUE_DATE_AUDIT = {
  COMMITTED: 'task_due_date_committed',
  REQUESTED: 'task_due_date_change_requested',
  APPROVED: 'task_due_date_change_approved',
  REJECTED: 'task_due_date_change_rejected',
  WITHDRAWN: 'task_due_date_change_withdrawn',
  CHANGED_DIRECT: 'task_due_date_changed_direct',
} as const;

export type DueDateRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';
export type DueDateRequestKind = 'request' | 'direct';

// 'none' = no Due date yet (the assignee sets it on the task form);
// 'unassigned' = nobody to commit; 'needs_commitment' = a date the current
// assignee has not committed to; 'committed' = locked.
export type CommitmentState = 'none' | 'unassigned' | 'needs_commitment' | 'committed';

export function commitmentState(task: {
  dueDate: string | null;
  assigneeUserId: number | null;
  dueDateCommittedByUserId: number | null;
}): CommitmentState {
  if (!task.dueDate) return 'none';
  if (task.assigneeUserId == null) return 'unassigned';
  return task.dueDateCommittedByUserId === task.assigneeUserId ? 'committed' : 'needs_commitment';
}

export interface DueDatePermissions {
  canCommit: boolean;
  canRequest: boolean;
  canWithdraw: boolean;
  canChangeDirect: boolean;
  canDecide: boolean;
}

export function dueDatePermissions(
  task: { status: string; dueDate: string | null; assigneeUserId: number | null; dueDateCommittedByUserId: number | null },
  user: { id: number; role: UserRole },
  trackingOn: boolean,
  pending: { requestedByUserId: number } | null,
): DueDatePermissions {
  const none = { canCommit: false, canRequest: false, canWithdraw: false, canChangeDirect: false, canDecide: false };
  if (!trackingOn || DUE_DATE_FROZEN_STATUSES.includes(task.status)) return none;
  const state = commitmentState(task);
  const isAssignee = task.assigneeUserId === user.id;
  const isDecider = DUE_DATE_DECIDE_ROLES.includes(user.role);
  return {
    canCommit: isAssignee && state === 'needs_commitment',
    canRequest: isAssignee && state === 'committed' && !pending,
    canWithdraw: !!pending && pending.requestedByUserId === user.id,
    canChangeDirect: isDecider && !isAssignee && !!task.dueDate,
    canDecide: isDecider && !!pending && pending.requestedByUserId !== user.id,
  };
}

export interface DueDateChangeRequestedEvent {
  tenantId: number;
  taskId: number;
  title: string;
  requestId: number;
  requesterUserId: number;
  requesterEmail: string;
  currentDueDate: string;
  requestedDueDate: string;
  reason: string;
}

export interface DueDateChangeDecidedEvent {
  tenantId: number;
  taskId: number;
  title: string;
  requestId: number;
  requesterUserId: number;
  decision: 'approved' | 'rejected';
  requestedDueDate: string;
  note: string | null;
  actorUserId: number;
  actorEmail: string;
}

export interface DueDateChangedDirectEvent {
  tenantId: number;
  taskId: number;
  title: string;
  assigneeUserId: number | null;
  oldDueDate: string;
  newDueDate: string;
  reason: string;
  actorUserId: number;
  actorEmail: string;
}
