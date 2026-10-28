// Turns one audit entry into the assignment / Due date event it records,
// or null if it records neither. Pure - no Nest/TypeORM imports. Used live
// by AuditLogService; migrations/2026-10-performance-metrics-backfill.sql
// applies the same rules in SQL to the history (a test checks both give
// the same rows).
import { CommitmentEventKind } from './task-commitment-event.entity';

export const COMMITMENT_AUDIT_ACTIONS = [
  'task_created',
  'task_defect_created',
  'task_assigned',
  'task_reassigned',
  'task_escalation_reassigned',
  'task_updated',
  'task_due_date_committed',
];

export interface CommitmentAuditEntry {
  id: number;
  tenantId: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  userId: number | null;
  userRole: string | null;
  createdAt: Date;
  // Parsed JSON, exactly as stored.
  details: Record<string, any> | null;
}

export interface CommitmentEventValues {
  tenantId: number;
  taskId: number;
  kind: CommitmentEventKind;
  assigneeUserId: number | null;
  previousAssigneeUserId: number | null;
  actorUserId: number | null;
  actorRole: string | null;
  occurredAt: Date;
  oldDueDate: string | null;
  newDueDate: string | null;
  direction: 'later' | 'earlier' | null;
  auditLogId: number;
}

function userIdOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function dateOf(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value.slice(0, 10);
}

export function commitmentEventFromAudit(entry: CommitmentAuditEntry): CommitmentEventValues | null {
  if (entry.entityType !== 'ProjectTask' || entry.entityId == null || !COMMITMENT_AUDIT_ACTIONS.includes(entry.action)) return null;
  const d = entry.details ?? {};
  const base = {
    tenantId: entry.tenantId,
    taskId: entry.entityId,
    actorUserId: entry.userId ?? null,
    actorRole: entry.userRole ?? null,
    occurredAt: entry.createdAt,
    auditLogId: entry.id,
    previousAssigneeUserId: null as number | null,
    oldDueDate: null as string | null,
    newDueDate: null as string | null,
    direction: null as 'later' | 'earlier' | null,
  };

  switch (entry.action) {
    case 'task_created':
    case 'task_defect_created':
    case 'task_assigned': {
      const assignee = userIdOf(d.assigneeUserId);
      return assignee == null ? null : { ...base, kind: 'assigned', assigneeUserId: assignee };
    }
    case 'task_reassigned':
    case 'task_escalation_reassigned': {
      const assignee = userIdOf(d.assigneeUserId);
      const previous = userIdOf(d.previousAssigneeUserId);
      if (assignee === previous) return null;
      return { ...base, kind: assignee == null ? 'unassigned' : 'assigned', assigneeUserId: assignee, previousAssigneeUserId: previous };
    }
    case 'task_updated': {
      const updated = d.updated;
      if (!updated || typeof updated !== 'object' || !Object.prototype.hasOwnProperty.call(updated, 'dueDate')) return null;
      const oldDate = dateOf(d.previous?.dueDate);
      const newDate = dateOf(updated.dueDate);
      if (oldDate === newDate) return null;
      // The assignee's own date through the Due date card (Performance
      // Tracking) is their commitment, not a change.
      const committed = d.dueDateCommitment === true && oldDate != null && newDate != null;
      const kind: CommitmentEventKind = committed ? 'due_committed' : oldDate == null ? 'due_set' : newDate == null ? 'due_cleared' : 'due_changed';
      return {
        ...base,
        kind,
        assigneeUserId: userIdOf(d.previous?.assigneeUserId),
        oldDueDate: oldDate,
        newDueDate: newDate,
        direction: kind === 'due_changed' ? (newDate! > oldDate! ? 'later' : 'earlier') : null,
      };
    }
    // Performance Tracking: the assignee confirmed the proposed date as it
    // is (their own date comes through task_updated above).
    case 'task_due_date_committed': {
      const date = dateOf(d.dueDate);
      if (d.confirmed !== true || date == null) return null;
      return { ...base, kind: 'due_committed', assigneeUserId: userIdOf(d.assigneeUserId) ?? entry.userId ?? null, oldDueDate: date, newDueDate: date };
    }
    default:
      return null;
  }
}
