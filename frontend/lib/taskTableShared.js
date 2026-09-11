// Shared between DeveloperTaskWorkboard (My Tasks) and TeamTaskWorkboard
// (Team Tasks) - the task status vocabulary, which statuses count as
// "done" (hidden by default, toggled via "Show completed tasks"), and the
// row-tint/legend color mapping, so the two tables can never visually
// drift apart from each other.

// Mirrors TASK_STATUSES on the backend (task-status-percent.entity.ts) -
// the two Released statuses are dormant (no code path sets them anymore)
// but existing tasks can still carry one, so they stay selectable here.
export const TASK_STATUSES = [
  'Development',
  'Feedback',
  'Re-Feedback',
  'Failed',
  'Pass',
  'Released - No Showstoppers',
  'Released - With Showstoppers',
];

// Tasks in these statuses are done - they stay in the table forever
// (nothing ever deletes/archives a task). Hidden by default; the "Show
// completed tasks" toggle reveals them. Mirrors COMPLETED_STATUSES on the
// backend (TasksService) - keep both lists in sync by hand, there's no
// shared constants module across frontend/backend in this codebase.
export const COMPLETED_STATUSES = ['Pass', 'Released - No Showstoppers', 'Released - With Showstoppers'];

export const LEGEND_ITEMS = [
  { label: 'Development', swatch: 'var(--color-slate-tint)' },
  { label: 'Feedback / Re-Feedback', swatch: 'var(--color-plum-tint)' },
  { label: 'Pass', swatch: 'var(--color-moss-tint)' },
  { label: 'Failed / Released - With Showstoppers', swatch: 'var(--color-red-tint)' },
  { label: 'Released - No Showstoppers', swatch: 'var(--color-teal-tint)' },
];

// Status is deliberately not its own table column in either view - it's
// expressed purely as row background color. Takes the importing
// component's own `styles` (issues.module.css) import so the returned
// class names resolve against that module instance.
export function buildRowTintClass(styles) {
  return {
    Feedback: styles.rowTintPlum,
    'Re-Feedback': styles.rowTintPlum,
    Pass: styles.rowTintMoss,
    Failed: styles.rowTintRed,
    'Released - With Showstoppers': styles.rowTintRed,
    'Released - No Showstoppers': styles.rowTintTeal,
  };
}

// Only offer statuses that can actually appear once completed tasks are
// hidden - picking "Pass" from the dropdown would otherwise always
// dead-end on an empty table.
export function selectableStatuses(showCompleted) {
  return showCompleted ? TASK_STATUSES : TASK_STATUSES.filter((s) => !COMPLETED_STATUSES.includes(s));
}
