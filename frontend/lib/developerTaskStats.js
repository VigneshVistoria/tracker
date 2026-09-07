export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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
// "Overdue" is two halves added together: tasks past their own Due Date
// (excluding 'Pass' - a finished task isn't meaningfully overdue even if
// it finished after its Due Date), plus dependency tickets this Developer
// owns to clear (Outbound) whose *parent task's* Due Date has passed -
// those tickets have no Due Date of their own.
export function computeDeveloperTaskStats(tasks, outbound, today = todayISO()) {
  const rejectedTasks = tasks.filter((t) => t.status === 'Failed');
  const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== 'Pass');
  const overdueOutbound = outbound.filter((t) => t.parentTaskDueDate && t.parentTaskDueDate < today);
  return {
    rejectedTasks,
    overdueTasks,
    overdueOutbound,
    overdueCount: overdueTasks.length + overdueOutbound.length,
  };
}
