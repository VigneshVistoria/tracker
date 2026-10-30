// Performance Tracking C4 - handover (2026-10-30, fast-track: the open
// rules are settings or defaults listed for the Technical Director in
// /home/ec2-user/perf-tracking-defaults.md).
//
//  * The task's assignee (or a PM/Admin for them) hands the task over with
//    a template - every field mandatory, at least handoverFieldMin (10)
//    characters: what was done, how to test, known issues, dependencies,
//    environment - and the next owner (a Developer, Designer or DevOps).
//  * One pending handover per task. Nothing moves until the next owner
//    decides: Accept reassigns the task to them (the normal reassignment,
//    audited); Reject needs a reason and leaves the task where it was.
//    The giver (or a PM/Admin) can cancel a pending one.
//  * While it is pending, the next owner may view the task (to read the
//    template and decide) - TasksService.isPendingHandoverReceiver; the
//    access ends with the decision.
//  * Only on a project with Performance Tracking ON; never on finished
//    tasks (Pass, Junk, Closed, Released). In-app notifications.
//  * C4 (metrics/tracking-metrics.ts) = of the handovers the person gave
//    that were decided in the window, the % accepted (not rejected).
import { UserRole } from '../users/user.entity';

export const HANDOVER_ON_BEHALF_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
export const HANDOVER_CLOSED_STATUSES = ['Pass', 'Junk', 'Closed', 'Released - No Showstoppers', 'Released - With Showstoppers'];

export const HANDOVER_FIELDS = ['whatDone', 'howToTest', 'knownIssues', 'dependencies', 'environment'] as const;
export type HandoverField = (typeof HANDOVER_FIELDS)[number];
export const HANDOVER_FIELD_LABELS: Record<HandoverField, string> = {
  whatDone: 'What was done',
  howToTest: 'How to test',
  knownIssues: 'Known issues',
  dependencies: 'Dependencies',
  environment: 'Environment',
};

export const HANDOVER_AUDIT = {
  STARTED: 'task_handover_started',
  ACCEPTED: 'task_handover_accepted',
  REJECTED: 'task_handover_rejected',
  CANCELLED: 'task_handover_cancelled',
} as const;

export type HandoverStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface TaskHandoverEvent {
  tenantId: number;
  taskId: number;
  title: string;
  kind: 'started' | 'accepted' | 'rejected' | 'cancelled';
  recipientUserId: number;
  actorUserId: number;
  actorEmail: string;
  reason?: string | null;
}

// Every template field filled to the minimum: the problem, or null.
export function templateProblem(values: Partial<Record<HandoverField, string>>, min: number): string | null {
  const short = HANDOVER_FIELDS.filter((f) => (values[f] ?? '').trim().length < min);
  if (short.length) return `Fill in every field with at least ${min} characters (${short.map((f) => HANDOVER_FIELD_LABELS[f]).join(', ')}). Write "None" in full if there is nothing, e.g. "None known".`;
  return null;
}
