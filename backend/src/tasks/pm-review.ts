import { addBusinessDays, toDateOnlyString } from '../common/business-days';

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
  const due = effectiveDueDate(task);
  return !!due && due < today;
}
