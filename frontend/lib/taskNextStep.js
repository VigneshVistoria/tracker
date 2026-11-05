import { isQaReviewOverdue } from './developerTaskStats';

// "Who's up next?" for the task header (2026-11-04). Display only - it reads
// the task's status, its latest review round and the stored QA review due
// date (ProjectTask.qaReviewDueDate, set on every QA/Peer submission by the
// backend: 5 working days, resubmissions included). It never computes a
// deadline of its own, so it always agrees with Late to QA / Non-compliance.
//
// Returns { stage, who, due, late } or null when there is nothing to show.
// `who` is a display name or a role ("QA team", "Program Manager").

const PEER_STAGES = { 'Peer Review': 'Peer review', 'Re-Peer-Review': 'Peer re-review' };
const QA_STAGES = { Feedback: 'QA review', 'Re-Feedback': 'QA retest', 'Returned to QA': 'Back with QA' };

export function taskNextStep(task, reviews = []) {
  if (!task) return null;
  const assignee = task.assigneeFullName || task.assigneeEmail || null;
  const latest = [...reviews].sort((a, b) => b.roundNumber - a.roundNumber)[0] || null;
  const pending = latest && latest.status === 'pending' ? latest : null;
  const reviewDue = (stage, who) => ({
    stage,
    who,
    // Returned to QA is an evidence edit, not a review on the clock.
    due: task.status === 'Returned to QA' ? null : task.qaReviewDueDate || null,
    late: isQaReviewOverdue(task),
  });

  switch (task.status) {
    case 'Pass':
      return { stage: 'Passed', who: null, due: null, late: false };
    case 'Junk':
    case 'Closed':
      return null;
    case 'Hold':
      return { stage: 'On hold', who: 'Program Manager', due: null, late: false };
    case 'Escalated':
    case 'Disputed':
      return { stage: task.status === 'Escalated' ? 'Escalated' : 'Disputed', who: 'Program Manager', due: null, late: false };
    case 'Pending PM Review':
      return { stage: 'PM review', who: 'Program Manager', due: null, late: false };
    case 'Failed':
    case 'PM Feedback':
    case 'Not Ready for Testing':
      return { stage: 'Fix and resubmit', who: assignee || 'Unassigned', due: null, late: false };
    default:
      break;
  }

  if (PEER_STAGES[task.status]) {
    return reviewDue(PEER_STAGES[task.status], pending?.reviewerFullName || 'Peer Reviewer');
  }
  if (QA_STAGES[task.status]) {
    // A defect is retested by the QA who raised it, not the QA queue.
    const who = task.isDefect ? task.createdByFullName || task.createdByEmail || 'QA who raised it' : 'QA team';
    return reviewDue(QA_STAGES[task.status], who);
  }
  // Development (or any status added later): with the assignee. A dependency
  // task (2026-11-05) reads "In progress" - it is resolved, not reviewed.
  if (task.dependencyTicketId != null) {
    return { stage: 'In progress', who: assignee || 'Unassigned', due: null, late: false };
  }
  return { stage: 'In development', who: assignee || 'Unassigned', due: null, late: false };
}
