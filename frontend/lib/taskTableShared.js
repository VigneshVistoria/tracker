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
  'Escalated',
  'Failed',
  'Pass',
  'Junk',
  'Released - No Showstoppers',
  'Released - With Showstoppers',
];

// Tasks in these statuses are done - they stay in the table forever
// (nothing ever deletes/archives a task). Hidden by default; the "Show
// completed tasks" toggle reveals them. Mirrors COMPLETED_STATUSES on the
// backend (TasksService) - keep both lists in sync by hand, there's no
// shared constants module across frontend/backend in this codebase. Junk
// is terminal (a PM closed it, nothing left to do) so it's grouped here
// too - Escalated is not, since it's still awaiting a PM decision.
export const COMPLETED_STATUSES = ['Pass', 'Junk', 'Released - No Showstoppers', 'Released - With Showstoppers'];

export const LEGEND_ITEMS = [
  { label: 'Development', swatch: 'var(--color-slate-tint)' },
  { label: 'Feedback / Re-Feedback', swatch: 'var(--color-plum-tint)' },
  { label: 'Escalated', swatch: 'var(--color-amber-tint)' },
  { label: 'Pass', swatch: 'var(--color-moss-tint)' },
  { label: 'Failed / Released - With Showstoppers', swatch: 'var(--color-red-tint)' },
  { label: 'Junk', swatch: 'var(--color-slate-tint)' },
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
    Escalated: styles.rowTintAmber,
    Pass: styles.rowTintMoss,
    Failed: styles.rowTintRed,
    Junk: styles.rowTintSlate,
    'Released - With Showstoppers': styles.rowTintRed,
    'Released - No Showstoppers': styles.rowTintTeal,
  };
}

// Same status->color mapping as buildRowTintClass above, but for Team
// Tasks' tile/card view (a left rail accent instead of a full-row tint) -
// same reasoning, takes the importing component's own styles import.
export function buildRowRailClass(styles) {
  return {
    Feedback: styles.railPlum,
    'Re-Feedback': styles.railPlum,
    Escalated: styles.railAmber,
    Pass: styles.railMoss,
    Failed: styles.railRed,
    Junk: styles.railSlate,
    'Released - With Showstoppers': styles.railRed,
    'Released - No Showstoppers': styles.railTeal,
  };
}

// Team Tasks' status tabs (TeamTaskWorkboard.js) - one tab per LEGEND_ITEMS
// entry above (same grouping: Feedback/Re-Feedback share a tab, as do
// Failed/Released - With Showstoppers), plus 'All'. `statuses` is what
// gets comma-joined and sent to GET /tasks/team's `status` param.
export const STATUS_TAB_GROUPS = [
  { key: 'All', label: 'All', statuses: [] },
  { key: 'Development', label: 'Development', statuses: ['Development'] },
  { key: 'Feedback', label: 'Feedback / Re-Feedback', statuses: ['Feedback', 'Re-Feedback'] },
  { key: 'Escalated', label: 'Escalated', statuses: ['Escalated'] },
  { key: 'Pass', label: 'Pass', statuses: ['Pass'] },
  { key: 'Failed', label: 'Failed / Released - With Showstoppers', statuses: ['Failed', 'Released - With Showstoppers'] },
  { key: 'Junk', label: 'Junk', statuses: ['Junk'] },
  { key: 'ReleasedNoShowstoppers', label: 'Released - No Showstoppers', statuses: ['Released - No Showstoppers'] },
];

// Same "don't dead-end on an empty table" reasoning as selectableStatuses
// above - a tab is hidden only once every status it represents is a
// completed one (so 'Failed / Released - With Showstoppers' stays visible
// even with completed tasks hidden, since Failed itself isn't completed).
export function visibleStatusTabs(showCompleted) {
  if (showCompleted) return STATUS_TAB_GROUPS;
  return STATUS_TAB_GROUPS.filter(
    (g) => g.key === 'All' || g.statuses.some((s) => !COMPLETED_STATUSES.includes(s)),
  );
}

// Only offer statuses that can actually appear once completed tasks are
// hidden - picking "Pass" from the dropdown would otherwise always
// dead-end on an empty table.
export function selectableStatuses(showCompleted) {
  return showCompleted ? TASK_STATUSES : TASK_STATUSES.filter((s) => !COMPLETED_STATUSES.includes(s));
}
