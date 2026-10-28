// Performance Tracking, Wave 1 (2026-10-28, approved by the user) - rules
// shared by the service and the tests. Pure - no Nest/TypeORM imports.
//
// S1 (this stage) is the foundation only: the per-project switch (OFF by
// default), the editable thresholds and the task status event log. No
// metric is computed or shown yet. Decisions recorded for later stages:
// committed date = the first Due date the assignee sets, changed only with
// a reason and PM/Admin approval; D1 delivered = final QA submission that
// QA later passes; Not ready counts in Q1 except a declared dependency
// owned by someone else (setting, from go-live); reopen after Pass is
// PM/Admin with a reason; C5 "updated" = status change or progress note by
// the assignee; O3 is Chase only; Blocked is a flag, not a status;
// Developer, Designer and DevOps are measured.
import { UserRole } from '../users/user.entity';

// Admin and Program Manager edit the thresholds and switch projects.
export const PERFORMANCE_TRACKING_SETTINGS_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

export const PERFORMANCE_TRACKING_AUDIT = {
  SETTINGS_UPDATED: 'performance_tracking_settings_updated',
  PROJECT_SWITCHED: 'project_performance_tracking_switched',
} as const;

// The audit actions that change a task's status. MUST match the latest
// tracker_status_event_action() (migrations/2026-10-performance-tracking-
// qa-intake.sql) - test/performance-tracking.e2e-spec.ts checks.
export const STATUS_EVENT_AUDIT_ACTIONS = [
  'task_created', 'task_defect_created', 'task_status_changed',
  'task_qa_submitted', 'task_pm_review_submitted', 'task_peer_review_submitted',
  'task_qa_approved', 'task_qa_rejected', 'task_qa_escalated', 'task_qa_not_ready', 'task_qa_decision_reverted',
  'task_peer_review_approved', 'task_peer_review_rejected',
  'task_pm_sent_to_qa', 'task_pm_sent_back', 'task_pm_sent_back_from_qa',
  'task_returned_to_qa', 'task_return_to_qa_sent_back',
  'task_escalation_reassigned', 'task_escalation_closed_junk',
  'task_marked_junk', 'task_restored_from_junk',
  'task_held', 'task_released_from_hold', 'task_closed', 'task_reopened',
  'defect_triage_disputed', 'defect_dispute_decided',
  // S4 (2026-10-28) - migrations/2026-10-performance-tracking-qa-intake.sql
  // holds the latest definition.
  'task_reopened_after_pass',
];

export interface PerformanceTrackingThresholds {
  baselineDays: number;
  notReadyDeclaredDependencyExempt: boolean;
  earlyWarningWorkingDays: number;
  dateMovesFlagCount: number;
  statusFreshWorkingDays: number;
  chasesPerTasks: number;
  reopenWindowDays: number;
}

export const PERFORMANCE_TRACKING_DEFAULTS: PerformanceTrackingThresholds = {
  baselineDays: 28,
  notReadyDeclaredDependencyExempt: true,
  earlyWarningWorkingDays: 2,
  dateMovesFlagCount: 2,
  statusFreshWorkingDays: 2,
  chasesPerTasks: 10,
  reopenWindowDays: 30,
};

// Validation limits, shared with the DTO.
export const THRESHOLD_LIMITS: Record<Exclude<keyof PerformanceTrackingThresholds, 'notReadyDeclaredDependencyExempt'>, [number, number]> = {
  baselineDays: [0, 180],
  earlyWarningWorkingDays: [0, 30],
  dateMovesFlagCount: [1, 20],
  statusFreshWorkingDays: [1, 30],
  chasesPerTasks: [1, 100],
  reopenWindowDays: [1, 365],
};

const DAY_MS = 24 * 60 * 60 * 1000;

// A switched-on project is in Baseline (no scores shown) until
// `baselineDays` full days after it was FIRST switched on - switching it off
// and on again does not restart the Baseline.
export function projectTrackingPhase(
  enabled: boolean,
  since: Date | null,
  now: Date,
  baselineDays: number,
): { phase: 'off' | 'baseline' | 'scoring'; baselineEndsAt: Date | null } {
  if (!enabled || !since) return { phase: 'off', baselineEndsAt: null };
  const baselineEndsAt = new Date(since.getTime() + baselineDays * DAY_MS);
  return { phase: now < baselineEndsAt ? 'baseline' : 'scoring', baselineEndsAt };
}
