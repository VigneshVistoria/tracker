// Performance Tracking, Wave 1 Stage S4b (2026-10-28, decisions from the
// user) - task type, requirement ID, client impact (L1, L2) and the PM's
// decision on a developer's improvement (O5). Pure - no Nest/TypeORM
// imports. Applies only while the task's project has Performance Tracking
// switched ON; OFF changes nothing. Defects (isDefect) have none of these.
// Existing tasks stay "Not set" - no reclassification.
//
//  * Type (Feature / Improvement / Other): required at creation, no
//    default - set by whoever creates the task (a PM, or a developer for
//    their own task). Afterwards a PM or Admin changes it.
//  * Requirement ID and client impact: the PM fills them at creation;
//    afterwards the PM or the assignee edits them. Before QA submission a
//    Feature needs a requirement ID, and a Feature or Improvement needs a
//    client impact of at least 20 characters (optional for Other); before
//    Peer Review, a Feature needs the same. Client
//    impact is internal - never shown on the client portal.
//  * O5: a PM or Admin accepts or declines an Improvement a developer created
//    (declining keeps the type; a reason is required). Only accepted ones
//    count.
//  * Bulk import takes optional Type / Requirement ID / Client impact
//    columns, checked against the same rules.
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';

export type TaskType = 'feature' | 'improvement' | 'other';
export const TASK_TYPES: TaskType[] = ['feature', 'improvement', 'other'];
export const TASK_TYPE_LABELS: Record<TaskType, string> = { feature: 'Feature', improvement: 'Improvement', other: 'Other' };

export const REQUIREMENT_ID_MAX = 100;
export const CLIENT_IMPACT_MIN = 20;
export const CLIENT_IMPACT_MAX = 2000;
export const DECLINE_REASON_MIN = 10;

// Who changes the type after creation and decides improvements (PM or
// Admin), and who edits the requirement ID / client impact (PM, plus the
// assignee - checked in the service).
export const TASK_TYPE_EDIT_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
export const IMPROVEMENT_DECIDE_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
export const TASK_TEXT_EDIT_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER];

export type ImprovementDecision = 'accepted' | 'declined';

export const TASK_FIELDS_AUDIT = {
  FIELDS_UPDATED: 'task_tracking_fields_updated',
  IMPROVEMENT_DECIDED: 'task_improvement_decided',
} as const;

// "Feature" / "improvement" (any case) -> the stored value, or null.
export function parseTaskType(value: unknown): TaskType | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return (TASK_TYPES as string[]).includes(v) ? (v as TaskType) : null;
}

// Length problems with the optional texts (null = fine).
export function fieldProblems(fields: { requirementId?: string | null; clientImpact?: string | null }): string[] {
  const problems: string[] = [];
  if (fields.requirementId != null && fields.requirementId.trim().length > REQUIREMENT_ID_MAX) {
    problems.push(`Requirement ID must be ${REQUIREMENT_ID_MAX} characters or fewer.`);
  }
  if (fields.clientImpact != null && fields.clientImpact.trim() !== '') {
    const n = fields.clientImpact.trim().length;
    if (n < CLIENT_IMPACT_MIN) problems.push(`Client impact must be at least ${CLIENT_IMPACT_MIN} characters.`);
    if (n > CLIENT_IMPACT_MAX) problems.push(`Client impact must be ${CLIENT_IMPACT_MAX} characters or fewer.`);
  }
  return problems;
}

// What a task still needs before QA submission (tracked project).
export function missingBeforeSubmission(task: { isDefect: boolean; taskType: TaskType | null; requirementId: string | null; clientImpact: string | null }): string[] {
  if (task.isDefect || !task.taskType) return [];
  const missing: string[] = [];
  if (task.taskType === 'feature' && !(task.requirementId || '').trim()) missing.push('a Requirement ID (Feature)');
  if ((task.taskType === 'feature' || task.taskType === 'improvement') && (task.clientImpact || '').trim().length < CLIENT_IMPACT_MIN) {
    missing.push(`a client impact of at least ${CLIENT_IMPACT_MIN} characters (${TASK_TYPE_LABELS[task.taskType]})`);
  }
  return missing;
}

// O5 applies to an Improvement a developer created.
export function isSelfInitiatedImprovement(task: { isDefect: boolean; taskType: TaskType | null }, creatorRole: UserRole | null): boolean {
  return !task.isDefect && task.taskType === 'improvement' && creatorRole != null && DEVELOPER_EQUIVALENT_ROLES.includes(creatorRole);
}
