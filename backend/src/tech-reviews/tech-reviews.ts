// Performance Tracking Q5 - technical review (2026-10-30, fast-track: the
// open rules are settings or defaults listed for the Technical Director in
// /home/ec2-user/perf-tracking-defaults.md).
//
//  * Reviewers are named people (setting techReviewerUserIds, default #3,
//    the Technical Director; an architect is added on Performance Tracking
//    Settings), chosen from Admin, Executive and Program Manager accounts.
//  * Each review scores one item of a person's work (a task, a pull
//    request...) 1-5 on every criterion of the rubric (setting
//    techReviewCriteria). Its average is the review's score.
//  * techReviewsPerMonth (2) reviews per person per month; more are
//    refused. Only the current or the previous month can be reviewed.
//  * A review belongs to a tracked project (the task's, when one is
//    given), so Q5 is stored per project like every metric.
//  * Only the reviewer who wrote it can edit it; it is never deleted. Each
//    review has an append-only evidence log (reviewer, the person reviewed,
//    PM or Admin). Everything is audited.
//  * Who sees: PM, Executive, Admin and the reviewers - everyone;
//    Developer, Designer, DevOps - their own; QA and clients - nothing.
//  * Q5 (metrics/tracking-metrics.ts) = the average review score in the
//    window; scored by rounding it (1-5); a single review is enough data.
import { UserRole } from '../users/user.entity';

export const TECH_REVIEW_SEE_ALL_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];
export const TECH_REVIEW_EVIDENCE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

export const TECH_REVIEW_AUDIT = {
  CREATED: 'tech_review_created',
  UPDATED: 'tech_review_updated',
  EVIDENCE_ADDED: 'tech_review_evidence_added',
} as const;

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Every criterion scored 1-5 and nothing else: the problem, or null.
export function scoresProblem(scores: Record<string, unknown>, criteria: string[]): string | null {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return 'Scores are missing.';
  const missing = criteria.filter((c) => scores[c] === undefined);
  if (missing.length) return `Score every item of the rubric (missing: ${missing.join(', ')}).`;
  const extra = Object.keys(scores).filter((k) => !criteria.includes(k));
  if (extra.length) return `Not on the rubric: ${extra.join(', ')}.`;
  if (criteria.some((c) => !Number.isInteger(scores[c]) || (scores[c] as number) < 1 || (scores[c] as number) > 5)) return 'Each score must be a whole number from 1 to 5.';
  return null;
}

export function averageScore(scores: Record<string, number>): number {
  const values = Object.values(scores);
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
}

// The rubric list itself: 1-10 distinct names of 2-60 characters.
export function criteriaProblem(criteria: string[]): string | null {
  if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > 10) return 'The rubric needs 1 to 10 items.';
  const names = criteria.map((c) => (typeof c === 'string' ? c.trim() : ''));
  if (names.some((c) => c.length < 2 || c.length > 60)) return 'Each rubric item needs 2 to 60 characters.';
  if (new Set(names.map((c) => c.toLowerCase())).size !== names.length) return 'Rubric items must be different.';
  return null;
}
