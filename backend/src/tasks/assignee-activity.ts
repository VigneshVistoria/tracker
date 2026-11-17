// Developer home "My work" (2026-11-17): splits "Working on it" into
// "Not started" and "In progress · updated N days ago". Display only -
// nothing here changes a task. Pure - no Nest/TypeORM imports.
//
// Activity = something the CURRENT assignee did on the task since it was
// given to them: a status change (STATUS_EVENT_AUDIT_ACTIONS), an edit of
// the task (fields, due date set/confirmed/change asked - user, 2026-11-17)
// or a progress note. The tracker has no developer comments and stores no
// branch/PR per task, so those cannot count yet.
import { commitmentEventFromAudit, CommitmentAuditEntry } from '../performance-metrics/commitment-events';
import { STATUS_EVENT_AUDIT_ACTIONS } from '../performance-tracking/performance-tracking';
import { DUE_DATE_AUDIT } from './due-date-change';

// Giving the task to someone is not that person's work on it.
const NOT_ACTIVITY = ['task_created', 'task_defect_created', 'task_assigned', 'task_reassigned', 'task_escalation_reassigned'];
const EDIT_ACTIONS = ['task_updated', 'task_due_date_edited', 'task_module_phase_edited', ...Object.values(DUE_DATE_AUDIT)];
export const ACTIVITY_AUDIT_ACTIONS = [...STATUS_EVENT_AUDIT_ACTIONS.filter((a) => !NOT_ACTIVITY.includes(a)), ...EDIT_ACTIONS];

export interface ActivityTask {
  id: number;
  assigneeUserId: number;
  createdAt: Date;
}
export interface ActivityNote {
  taskId: number;
  authorUserId: number;
  createdAt: Date;
}
// One review round (QA, peer or PM) - its creation is a submission.
export interface ActivitySubmission {
  taskId: number;
  submittedAt: Date;
}
export interface AssigneeActivity {
  taskId: number;
  assignedAt: string;
  lastActivityAt: string | null;
  // Latest submission for review (any round, any time) - the Submitted
  // list's sort date. null = never submitted (e.g. Hold, blocked).
  lastSubmittedAt: string | null;
}

export function assigneeActivity(
  tasks: ActivityTask[],
  audits: CommitmentAuditEntry[],
  notes: ActivityNote[],
  submissions: ActivitySubmission[] = [],
): AssigneeActivity[] {
  return tasks.map((task) => {
    const mine = audits.filter((a) => a.entityId === task.id);
    // Latest hand-over to the current assignee; a task created already
    // assigned with no audit trail falls back to its creation time.
    let assignedAt = new Date(task.createdAt);
    let found = false;
    for (const a of mine) {
      const ev = commitmentEventFromAudit(a);
      if (ev?.kind !== 'assigned' || ev.assigneeUserId !== task.assigneeUserId) continue;
      const at = new Date(a.createdAt);
      if (!found || at > assignedAt) assignedAt = at;
      found = true;
    }
    const times = [
      ...mine.filter((a) => a.userId === task.assigneeUserId && ACTIVITY_AUDIT_ACTIONS.includes(a.action)).map((a) => new Date(a.createdAt)),
      ...notes.filter((n) => n.taskId === task.id && n.authorUserId === task.assigneeUserId).map((n) => new Date(n.createdAt)),
    ].filter((t) => t >= assignedAt);
    const last = times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null;
    const subs = submissions.filter((x) => x.taskId === task.id).map((x) => new Date(x.submittedAt).getTime());
    return {
      taskId: task.id,
      assignedAt: assignedAt.toISOString(),
      lastActivityAt: last ? last.toISOString() : null,
      lastSubmittedAt: subs.length ? new Date(Math.max(...subs)).toISOString() : null,
    };
  });
}
