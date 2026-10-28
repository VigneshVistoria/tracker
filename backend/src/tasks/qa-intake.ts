// Performance Tracking, Wave 1 Stage S4 (2026-10-28, decisions from the
// user) - QA intake and reopen after Pass. Pure - no Nest/TypeORM imports.
// Everything here applies only while the task's project has Performance
// Tracking switched ON; OFF changes nothing.
//
//  * Test failed reasons: QA must pick ONE reason from an editable list
//    when rejecting (the existing comment stays required). Peer Review
//    rejections have no reason.
//  * Dependencies at submission: the developer answers "dependencies
//    met?" - Yes, or No with what they are still waiting on. They may
//    still submit. They can pick dependencies already recorded on the task
//    (its dependency tickets, its open blocker flag); something named only
//    in the text gets no protection. If QA then marks the round Not ready
//    because of a dependency, the round is "dependencyExempt" (left out of
//    Q1, charged to the owner in C2) only if a picked dependency was
//    recorded before the submission and is owned by someone else. Whether
//    the exemption applies is the setting notReadyDeclaredDependencyExempt
//    (ON; Technical Director confirmation pending).
//  * Reopen after Pass: PM or Admin, from Pass or Released, with a reason;
//    the task goes back to Development with a new proposed Due date (the
//    reopened work is a new commitment; the original D1 result stands).
//    For the same work failing again - a new problem is a new defect. Each
//    reopen is kept (task_reopens), counted on the task (reopenCount) and
//    logged in the status log as 'task_reopened_after_pass'; Q3 charges
//    the developer whose submission passed, within reopenWindowDays.
import { UserRole } from '../users/user.entity';

export const DEFAULT_QA_TEST_FAILED_REASONS = [
  'Fix does not work',
  'Regression (something else broke)',
  'Partially fixed',
  'Wrong scope',
  'Requirement not met',
];
export const QA_TEST_FAILED_REASON_MAX = 100;
export const QA_TEST_FAILED_REASONS_MAX_COUNT = 30;

// The Not-ready reason that means "blocked by a dependency" carries a FIXED
// internal code (2026-10-28, the user's decision). Its label can be renamed
// in the editable list (team_settings.qaNotReadyReasons) but the reason
// can't be removed and its code never changes - the Q1 exemption keys on
// the code, not the text. In the stored list it is the one object entry
// { label, code }; every other reason is a plain string.
export const NOT_READY_DEPENDENCY_CODE = 'blocked_by_dependency';
export const NOT_READY_DEPENDENCY_DEFAULT_LABEL = 'Blocked by a dependency';

export type StoredNotReadyReason = string | { label: string; code: string };

// The labels in order, and which one is the dependency reason. A list saved
// before the code existed is read by its default label; if it isn't there,
// the reason is added back at the end (it can't be removed).
export function resolveNotReadyReasons(saved: unknown, defaults: string[]): { reasons: string[]; dependencyReason: string } {
  const items: StoredNotReadyReason[] = Array.isArray(saved) && saved.length > 0 ? (saved as StoredNotReadyReason[]) : defaults;
  const reasons: string[] = [];
  let dependencyReason: string | null = null;
  for (const item of items) {
    const label = typeof item === 'string' ? item : item?.label;
    if (typeof label !== 'string' || !label) continue;
    reasons.push(label);
    if (typeof item === 'object' && item.code === NOT_READY_DEPENDENCY_CODE) dependencyReason = label;
  }
  if (dependencyReason == null) {
    const legacy = reasons.find((r) => r === NOT_READY_DEPENDENCY_DEFAULT_LABEL);
    dependencyReason = legacy ?? NOT_READY_DEPENDENCY_DEFAULT_LABEL;
    if (!legacy) reasons.push(dependencyReason);
  }
  return { reasons, dependencyReason };
}

export function storeNotReadyReasons(reasons: string[], dependencyReason: string): StoredNotReadyReason[] {
  return reasons.map((r) => (r === dependencyReason ? { label: r, code: NOT_READY_DEPENDENCY_CODE } : r));
}

export const REOPEN_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
export const REOPEN_FROM_STATUSES = ['Pass', 'Released - No Showstoppers', 'Released - With Showstoppers'];
export const REOPEN_TO_STATUS = 'Development';
export const REOPEN_REASON_MIN = 10;
export const WAITING_ON_MAX = 1000;

export const QA_INTAKE_AUDIT = {
  TEST_FAILED_REASONS_UPDATED: 'qa_test_failed_reasons_updated',
  REOPENED_AFTER_PASS: 'task_reopened_after_pass',
} as const;

// One dependency already recorded on the task that the developer picked
// at submission.
export interface DeclaredDependency {
  kind: 'ticket' | 'blocker';
  id: number;
  title: string;
  ownerUserId: number | null;
  ownerExternal: string | null;
  recordedAt: string;
  // Recorded before the submission and owned by someone else.
  protects: boolean;
}

export interface DependencyDeclaration {
  met: boolean;
  waitingOn: string | null;
  declared: DeclaredDependency[];
  declaredAt: string;
  submittedByUserId: number;
}

export function protects(dep: { ownerUserId: number | null; ownerExternal: string | null; recordedAt: Date }, submitterId: number, submittedAt: Date): boolean {
  const someoneElse = dep.ownerExternal != null || (dep.ownerUserId != null && dep.ownerUserId !== submitterId);
  return someoneElse && dep.recordedAt.getTime() < submittedAt.getTime();
}

// Not ready because of a dependency: exempt only with a protecting
// declaration.
// isDependencyReason: QA picked the reason with NOT_READY_DEPENDENCY_CODE.
export function notReadyDependencyExempt(isDependencyReason: boolean, declaration: DependencyDeclaration | null): boolean {
  return isDependencyReason && !!declaration && !declaration.met && declaration.declared.some((d) => d.protects);
}

export interface TaskReopenedEvent {
  tenantId: number;
  taskId: number;
  title: string;
  reason: string;
  proposedDueDate: string;
  assigneeUserId: number | null;
  passedByQaUserId: number | null;
  actorUserId: number;
  actorEmail: string;
}
