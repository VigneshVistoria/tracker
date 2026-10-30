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
import { DEFAULT_ESCALATION_REASONS, EscalationReason } from '../task-qa-reviews/escalation-reasons';
import { DEFAULT_SLA_DAYS, SECURITY_ROLE_CHOICES, SlaDays } from '../security-findings/security-findings';
import { DEFAULT_PRIORITY_TIERS, DEFAULT_SATISFACTION_QUESTIONS } from '../client-measures/client-measures';

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

// B1 (2026-10-30, fast-track plan): every decision still open with the
// Technical Director is a setting with a default, so the build need not
// wait. The defaults are listed for the TD in /home/ec2-user/perf-tracking-
// defaults.md.
//  * O1 blocker raise lag - when the clock starts.
export const BLOCKER_LAG_CLOCK_STARTS = ['dependency_overdue_or_blocker', 'blocker_flag', 'dependency_created'] as const;
export type BlockerLagClockStart = (typeof BLOCKER_LAG_CLOCK_STARTS)[number];
//  * Non-Compliance report next to the new scorecard, or scorecard only.
export const NON_COMPLIANCE_DISPLAYS = ['side_by_side', 'scorecard_only'] as const;
export type NonComplianceDisplay = (typeof NON_COMPLIANCE_DISPLAYS)[number];
//  * C1 - what counts as a "request" to a person.
export const REQUEST_SOURCES = ['owned_dependency', 'marked_request'] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];
//  * O3 - who may Chase (never the assignee, never a client).
export const CHASE_ROLE_CHOICES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE, UserRole.QA, UserRole.DEVELOPER];
//  * B3/B4 - who may override a score: named people (B4, the user's
//    decision 2026-10-30: Abdirahman #3, Technical Director, only), chosen
//    from Admin, Executive and Program Manager accounts.
export const OVERRIDE_USER_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.PROGRAM_MANAGER];
//  * B4 - the working calendar for anyone without their own (EAT,
//    07:30-15:30, Saturday + Sunday off) and the C1 response target.
export const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export interface PerformanceTrackingThresholds {
  baselineDays: number;
  notReadyDeclaredDependencyExempt: boolean;
  earlyWarningWorkingDays: number;
  dateMovesFlagCount: number;
  statusFreshWorkingDays: number;
  chasesPerTasks: number;
  reopenWindowDays: number;
  blockerLagClockStart: BlockerLagClockStart;
  // Score 5/4/3/2/1 at or above each percent; below the last = 1.
  percentBands: number[];
  // Breach counts: at or below each = 5/4/3/2; more than the last = 1.
  breachBands: number[];
  nonComplianceDisplay: NonComplianceDisplay;
  requestSources: RequestSource[];
  chaseRoles: UserRole[];
  // One Chase per task per person within this many hours.
  chaseCooldownHours: number;
  progressNoteMin: number;
  overrideUserIds: number[];
  calendarTimeZone: string;
  calendarWorkStart: string;
  calendarWorkEnd: string;
  calendarWeekendDays: number[];
  // C1: a request answered within this many working hours counts as on time.
  responseTargetWorkingHours: number;
  // Q4: a production defect counts within this many days of the release,
  // reported per escapedPerTasks tasks released.
  escapeWindowDays: number;
  escapedPerTasks: number;
  // Q5: named technical reviewers, reviews per person per month, rubric.
  techReviewerUserIds: number[];
  techReviewsPerMonth: number;
  techReviewCriteria: string[];
  // C3: weekly status report deadline (0 = Sunday ... 6 = Saturday, at
  // HH:MM, team time zone) and minimum length of done/plan.
  weeklyReportDeadlineDay: number;
  weeklyReportDeadlineTime: string;
  weeklyReportMinLength: number;
  // C4: every handover template field (and a rejection reason) needs this many characters.
  handoverFieldMin: number;
  // O4: the reasons QA picks on "Escalate to PM", each avoidable or not;
  // reported per escalationsPerRounds QA rounds.
  escalationReasons: EscalationReason[];
  escalationsPerRounds: number;
  // P1/P2: releases are few, so they get their own longer window and
  // their own minimum number of releases before a score.
  releaseWindowDays: number;
  releaseMinSample: number;
  // P3/P4: SLA working days per severity, who records and verifies
  // findings, and (like P1/P2) their own window and minimum.
  securitySlaDays: SlaDays;
  securityRoles: UserRole[];
  securityWindowDays: number;
  securityMinSample: number;
  // L3-L5: client priority tiers (most urgent first), the satisfaction
  // questions, and L4/L5's own window and minimum.
  clientPriorityTiers: string[];
  satisfactionQuestions: string[];
  clientWindowDays: number;
  clientMinSample: number;
}

export const PERFORMANCE_TRACKING_DEFAULTS: PerformanceTrackingThresholds = {
  baselineDays: 28,
  notReadyDeclaredDependencyExempt: true,
  earlyWarningWorkingDays: 2,
  dateMovesFlagCount: 2,
  statusFreshWorkingDays: 2,
  chasesPerTasks: 10,
  reopenWindowDays: 30,
  blockerLagClockStart: 'dependency_overdue_or_blocker',
  percentBands: [95, 85, 70, 50],
  breachBands: [0, 1, 2, 3],
  nonComplianceDisplay: 'side_by_side',
  requestSources: ['owned_dependency', 'marked_request'],
  chaseRoles: [...CHASE_ROLE_CHOICES],
  chaseCooldownHours: 24,
  progressNoteMin: 20,
  overrideUserIds: [],
  calendarTimeZone: 'Africa/Addis_Ababa',
  calendarWorkStart: '07:30',
  calendarWorkEnd: '15:30',
  calendarWeekendDays: [0, 6],
  responseTargetWorkingHours: 4,
  escapeWindowDays: 30,
  escapedPerTasks: 10,
  techReviewerUserIds: [],
  techReviewsPerMonth: 2,
  techReviewCriteria: ['Code quality', 'Design and architecture', 'Testing', 'Security', 'Documentation'],
  weeklyReportDeadlineDay: 4,
  weeklyReportDeadlineTime: '17:00',
  weeklyReportMinLength: 20,
  handoverFieldMin: 10,
  escalationReasons: DEFAULT_ESCALATION_REASONS.map((r) => ({ ...r })),
  escalationsPerRounds: 10,
  releaseWindowDays: 90,
  releaseMinSample: 3,
  securitySlaDays: { ...DEFAULT_SLA_DAYS },
  securityRoles: [...SECURITY_ROLE_CHOICES],
  securityWindowDays: 90,
  securityMinSample: 3,
  clientPriorityTiers: [...DEFAULT_PRIORITY_TIERS],
  satisfactionQuestions: [...DEFAULT_SATISFACTION_QUESTIONS],
  clientWindowDays: 90,
  clientMinSample: 3,
};

export type NumericThreshold =
  | 'baselineDays' | 'earlyWarningWorkingDays' | 'dateMovesFlagCount' | 'statusFreshWorkingDays'
  | 'chasesPerTasks' | 'reopenWindowDays' | 'chaseCooldownHours' | 'progressNoteMin' | 'responseTargetWorkingHours'
  | 'escapeWindowDays' | 'escapedPerTasks' | 'techReviewsPerMonth' | 'weeklyReportDeadlineDay' | 'weeklyReportMinLength' | 'handoverFieldMin' | 'escalationsPerRounds'
  | 'releaseWindowDays' | 'releaseMinSample' | 'securityWindowDays' | 'securityMinSample' | 'clientWindowDays' | 'clientMinSample';

// Validation limits, shared with the DTO.
export const THRESHOLD_LIMITS: Record<NumericThreshold, [number, number]> = {
  baselineDays: [0, 180],
  earlyWarningWorkingDays: [0, 30],
  dateMovesFlagCount: [1, 20],
  statusFreshWorkingDays: [1, 30],
  chasesPerTasks: [1, 100],
  reopenWindowDays: [1, 365],
  chaseCooldownHours: [0, 168],
  progressNoteMin: [5, 500],
  responseTargetWorkingHours: [1, 40],
  escapeWindowDays: [1, 365],
  escapedPerTasks: [1, 100],
  techReviewsPerMonth: [1, 10],
  weeklyReportDeadlineDay: [0, 6],
  weeklyReportMinLength: [5, 500],
  handoverFieldMin: [3, 500],
  escalationsPerRounds: [1, 100],
  releaseWindowDays: [28, 365],
  releaseMinSample: [1, 20],
  securityWindowDays: [28, 365],
  securityMinSample: [1, 20],
  clientWindowDays: [28, 365],
  clientMinSample: [1, 20],
};

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// A calendar's hours and weekend: the problem, or null when valid.
export function calendarProblem(c: { timeZone: string; workStart: string; workEnd: string; weekendDays: number[] }): string | null {
  if (!isValidTimeZone(c.timeZone)) return `Unknown time zone "${c.timeZone}".`;
  if (!HHMM.test(c.workStart) || !HHMM.test(c.workEnd)) return 'Working hours must be HH:MM, e.g. 07:30.';
  if (c.workStart >= c.workEnd) return 'Working hours must end after they start.';
  if (!Array.isArray(c.weekendDays) || c.weekendDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(c.weekendDays).size !== c.weekendDays.length || c.weekendDays.length > 6) {
    return 'Weekend days must be distinct days 0 (Sunday) to 6 (Saturday), and at least one day must be a working day.';
  }
  return null;
}

// The band lists: exactly 4 whole numbers. Percent bands strictly falling
// within 0-100; breach bands strictly rising from 0. Returns the problem,
// or null when valid.
export function bandProblem(kind: 'percentBands' | 'breachBands', bands: number[]): string | null {
  if (!Array.isArray(bands) || bands.length !== 4 || bands.some((b) => !Number.isInteger(b))) {
    return `${kind === 'percentBands' ? 'Percent' : 'Breach'} bands must be 4 whole numbers.`;
  }
  if (kind === 'percentBands') {
    if (bands.some((b) => b < 0 || b > 100)) return 'Percent bands must be between 0 and 100.';
    if (bands.some((b, i) => i > 0 && b >= bands[i - 1])) return 'Percent bands must go down, e.g. 95, 85, 70, 50.';
  } else {
    if (bands.some((b) => b < 0 || b > 1000)) return 'Breach bands must be between 0 and 1000.';
    if (bands.some((b, i) => i > 0 && b <= bands[i - 1])) return 'Breach bands must go up, e.g. 0, 1, 2, 3.';
  }
  return null;
}

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
