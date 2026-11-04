import { addBusinessDays, businessDaysBetween, toDateOnlyString } from '../common/business-days';
import { RETURNED_TO_QA_STATUS } from './return-to-qa';
import { DISPUTED_STATUS } from './defect-triage';

// PM review gate (2026-10-13, confirmed with the user): when a project has
// it switched on (Project.pmReviewEnabled), a developer's task submission
// waits for a Program Manager before QA sees it.
//   Pending PM Review - submitted, waiting for the PM. Not in QA Review.
//   PM Feedback       - the PM sent it back with a comment; the developer
//                       refines it and submits again. Not a QA rejection,
//                       so it never counts as one (that's why it isn't
//                       'Failed').
// Rounds are task_qa_reviews rows with reviewType 'pm'.
export const PM_REVIEW_STATUS = 'Pending PM Review';
export const PM_FEEDBACK_STATUS = 'PM Feedback';

// Time waiting for the PM never counts against the developer: while a
// task is Pending PM Review it is not overdue, and every working day it
// waited is added to its due date afterwards (pmWaitWorkingDays, summed
// on each PM decision). QA wait still counts, as before.
export function effectiveDueDate(task: { dueDate: string | null; pmWaitWorkingDays?: number | null }): string | null {
  if (!task.dueDate) return null;
  const extra = task.pmWaitWorkingDays || 0;
  if (extra <= 0) return task.dueDate;
  return toDateOnlyString(addBusinessDays(new Date(`${task.dueDate}T00:00:00Z`), extra));
}

// Due date passed (by effectiveDueDate) and not paused for PM review.
// Callers still apply their own completed/Hold/Closed rules.
export function isPastEffectiveDue(
  task: { status: string; dueDate: string | null; pmWaitWorkingDays?: number | null },
  today: string,
): boolean {
  if (task.status === PM_REVIEW_STATUS) return false;
  // Return to QA: with QA, not the developer (days added on send-back).
  if (task.status === RETURNED_TO_QA_STATUS) return false;
  // Disputed defect: with the PM (days added on the decision).
  if (task.status === DISPUTED_STATUS) return false;
  const due = effectiveDueDate(task);
  return !!due && due < today;
}

// Submitted and waiting for a reviewer (QA or a peer) - 2026-11-04.
export const AWAITING_REVIEW_STATUSES = ['Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review'];

// Overdue as the developer's own work, for lists and cards only: work
// waiting for a reviewer is with the reviewer, not the developer (user
// feedback 2026-11-04). The review delay shows separately (task header
// "Review due", QA queue, Non-Compliance "Overdue in review").
// isPastEffectiveDue() above stays as it is for Non-Compliance Late to QA.
//
// reviewWaitDays (KPI, 2026-11-04): working days the task already spent
// waiting for QA / peer reviewers (reviewWaitWorkingDays below), added to
// the due date the same way PM wait is. Lists and cards pass 0.
export function isDeveloperOverdue(
  task: { status: string; dueDate: string | null; pmWaitWorkingDays?: number | null },
  today: string,
  reviewWaitDays = 0,
): boolean {
  if (AWAITING_REVIEW_STATUSES.includes(task.status)) return false;
  if (!isPastEffectiveDue(task, today)) return false;
  if (reviewWaitDays <= 0) return true;
  return developerDueDate(task, reviewWaitDays)! < today;
}

// Review time is not the developer's (KPI, user decision 2026-11-04).
// A QA / peer round counts from submission to the reviewer's decision.
// Not counted: PM rounds (already in pmWaitWorkingDays), 'not_ready'
// (no real hand-over - the developer's clock kept running, same rule as
// Non-Compliance Late to QA), 'reverted' (the re-opened round with the
// same submit time covers that wait) and undecided rounds.
const REVIEW_WAIT_TYPES = ['qa', 'peer'];
const REVIEW_WAIT_STATUSES = ['approved', 'rejected', 'escalated', 'withdrawn'];
export type ReviewWaitRound = { id?: number; reviewType: string; status: string; submittedAt: Date | string; reviewedAt: Date | string | null };

export function reviewWaitWorkingDays(rounds: ReviewWaitRound[], exceptRound?: ReviewWaitRound): number {
  let days = 0;
  for (const r of rounds) {
    if (r === exceptRound) continue;
    if (!REVIEW_WAIT_TYPES.includes(r.reviewType) || !REVIEW_WAIT_STATUSES.includes(r.status) || !r.reviewedAt) continue;
    days += businessDaysBetween(new Date(r.submittedAt), new Date(r.reviewedAt));
  }
  return days;
}

// Effective due date (+ PM wait) plus review wait, in working days.
export function developerDueDate(
  task: { dueDate: string | null; pmWaitWorkingDays?: number | null },
  reviewWaitDays: number,
): string | null {
  const due = effectiveDueDate(task);
  if (!due || reviewWaitDays <= 0) return due;
  return toDateOnlyString(addBusinessDays(new Date(`${due}T00:00:00Z`), reviewWaitDays));
}
