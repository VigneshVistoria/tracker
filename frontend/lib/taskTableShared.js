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

// Status is expressed as row background color in every task list except
// Team Tasks, which also shows a colored Status badge (see
// statusBadgeStyle below) - confirmed with the user 2026-09, scoped to
// Team Tasks only for now. Takes the importing component's own `styles`
// (issues.module.css) import so the returned class names resolve against
// that module instance.
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

// Same status->color grouping as buildRowTintClass/buildRowRailClass above,
// for Team Tasks' colored Status badge (table column + tile) - an inline
// style object rather than a CSS module class, since these pair a tint
// background with a matching dark foreground rather than reusing an
// existing class. Development (and any unrecognized status) falls through
// to the same neutral slate LEGEND_ITEMS gives it.
const STATUS_BADGE_STYLE = {
  Feedback: { background: 'var(--color-plum-tint)', color: 'var(--color-plum-dark)' },
  'Re-Feedback': { background: 'var(--color-plum-tint)', color: 'var(--color-plum-dark)' },
  Escalated: { background: 'var(--color-amber-tint)', color: 'var(--color-amber-dark)' },
  Pass: { background: 'var(--color-moss-tint)', color: 'var(--color-moss-dark)' },
  Failed: { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  Junk: { background: 'var(--color-slate-tint)', color: 'var(--color-ink-soft)' },
  'Released - With Showstoppers': { background: 'var(--color-red-tint)', color: 'var(--color-red-dark)' },
  'Released - No Showstoppers': { background: 'var(--color-teal-tint)', color: 'var(--color-teal-dark)' },
};

export function statusBadgeStyle(status) {
  return STATUS_BADGE_STYLE[status] || { background: 'var(--color-slate-tint)', color: 'var(--color-ink-soft)' };
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

// Task Priority - Program Manager only (TasksService's PRIORITY_MUTATE_ROLES
// check), a separate, narrower vocabulary from the shared Issue/Dependency
// Priority enum (Critical/High/Medium/Low). Mirrors backend/src/tasks/
// task-priority.enum.ts - keep both lists in sync by hand, same as
// TASK_STATUSES above.
export const TASK_PRIORITIES = ['Immediate', 'High', 'Medium'];

const PRIORITY_RANK = { Immediate: 0, High: 1, Medium: 2 };

// Sort weight for My Tasks/Team Tasks/Task Backlog - unset ("Not Set")
// tasks always rank last.
export function priorityRank(priority) {
  return priority != null && priority in PRIORITY_RANK ? PRIORITY_RANK[priority] : 3;
}

// Deliberately not red/amber/teal/plum/moss/slate (the Status row-tint
// palette above) or the red-tint/red-dark Showstopper badge on Issues, so a
// Priority tag never reads as either of those at a glance.
const PRIORITY_TONE = { Immediate: 'error', High: 'warning', Medium: 'info' };

export function priorityTone(priority) {
  return PRIORITY_TONE[priority] || 'neutral';
}

export function priorityLabel(priority) {
  return priority || 'Not Set';
}

// Same three colors as priorityTone above, but as an actual CSS color
// instead of an abstract Badge tone - for Team Tasks' Workload view, whose
// chips use a raw inline style (colored left-edge stripe) rather than the
// Badge component. Pulled from the same --ds-color-error/warning/info
// tokens Badge's tone classes resolve to, so a task's stripe color always
// matches its Priority badge color everywhere else.
const PRIORITY_STRIPE_COLOR = {
  Immediate: 'var(--ds-color-error)',
  High: 'var(--ds-color-warning)',
  Medium: 'var(--ds-color-info)',
};

export function priorityStripeColor(priority) {
  return PRIORITY_STRIPE_COLOR[priority] || 'var(--color-border-strong)';
}
