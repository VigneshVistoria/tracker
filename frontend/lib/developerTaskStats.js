export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// A task past its own Due Date - excluding 'Pass'/'Junk', a finished task
// isn't meaningfully overdue even if it finished after its Due Date, and a
// Junk-closed task was never a real issue in the first place. 'Hold'/
// 'Closed' get the same exclusion (added 2026-09) - a task the PM paused
// or force-closed should never show as overdue. Mirrors the same rule
// TasksService.findTeam() computes server-side for Team Tasks' "Overdue"
// stat card (tasks.service.ts) - kept in sync by hand, same as every
// other frontend/backend status-list duplication in this codebase.
const NEVER_OVERDUE_STATUSES = ['Pass', 'Junk', 'Hold', 'Closed'];
export function isOverdueTask(task, today = todayISO()) {
  return Boolean(task.dueDate && task.dueDate < today && !NEVER_OVERDUE_STATUSES.includes(task.status));
}

// A task past its own QA Review Due Date (separate field from dueDate
// above, auto-set by TasksService.computeQaReviewDueDate() on every QA/
// Peer Review submission) while still actually pending a review decision -
// once QA/the reviewer has acted (Pass/Failed/Escalated/etc.) it's no
// longer meaningfully overdue for review. Mirrors TasksService.
// findQaQueue()/findDefectQueue()'s 'overdue' stat count server-side.
const QA_REVIEW_PENDING_STATUSES = ['Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review'];
export function isQaReviewOverdue(task, today = todayISO()) {
  return Boolean(
    task.qaReviewDueDate && task.qaReviewDueDate < today && QA_REVIEW_PENDING_STATUSES.includes(task.status),
  );
}

// Shared by the Developer Dashboard (components/DeveloperDashboard.js) and
// the My Tasks page's stat cards (pages/tasks/mine.js) - same underlying
// "Rejected"/"Overdue" rules computed once so the two views can never
// drift apart from each other.
//
// "Rejected" - tasks QA sent back that are still waiting on this Developer
// to act (status 'Failed'; once resubmitted a task moves to 'Re-Feedback'
// and is back with QA, no longer actionable here).
//
// "Overdue" is two halves added together: isOverdueTask() above, plus
// dependency tickets this Developer owns to clear (Outbound) whose *parent
// task's* Due Date has passed - those tickets have no Due Date of their own.
export function computeDeveloperTaskStats(tasks, outbound, today = todayISO()) {
  const rejectedTasks = tasks.filter((t) => t.status === 'Failed');
  const overdueTasks = tasks.filter((t) => isOverdueTask(t, today));
  const overdueOutbound = outbound.filter((t) => t.parentTaskDueDate && t.parentTaskDueDate < today);
  return {
    rejectedTasks,
    overdueTasks,
    overdueOutbound,
    overdueCount: overdueTasks.length + overdueOutbound.length,
  };
}
