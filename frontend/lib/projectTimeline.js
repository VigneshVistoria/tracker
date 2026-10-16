import { formatDate } from './formatDate';

// Project Timeline (2026-10-16) - the page-side copies of the rules in
// backend/src/project-timeline/project-timeline-rules.ts, so the table can
// flag rows while the PM edits, before anything is saved. The backend
// re-checks everything on Save changes; keep the two in step.

export const TIMELINE_STATUSES = ['To Do', 'In Progress', 'Completed', 'Delayed', 'On Hold'];

// Badge tones per status (Delayed is red on its own - it is never also "Overdue").
export const STATUS_TONE = {
  'To Do': 'neutral',
  'In Progress': 'info',
  Completed: 'success',
  Delayed: 'error',
  'On Hold': 'warning',
};

// Trims and collapses runs of spaces, like the backend's tidyName().
export function tidyName(value) {
  return String(value ?? '').replace(/[\s ]+/g, ' ').trim();
}

export function nameKey(value) {
  return tidyName(value).toLowerCase();
}

export function matchKeyFor(module, phase) {
  return `${nameKey(module)}|${nameKey(phase)}`;
}

// To Do only, end date before today (team time zone, from the server).
export function isOverdue(row, today) {
  return row.status === 'To Do' && !!row.endDate && row.endDate < today;
}

// Blocking problems for one row - Save is disabled while any row has one.
export function rowErrors(row) {
  const errors = [];
  if (!tidyName(row.module)) errors.push('Module is empty');
  if (!tidyName(row.phase)) errors.push('Phase is empty');
  if (row.startDate && row.endDate && row.endDate < row.startDate) errors.push('End date is before the start date');
  return errors;
}

// Shown, never blocking.
export function rowWarnings(row, today) {
  const warnings = [];
  if (row.status === 'Completed' && row.endDate && row.endDate > today) {
    warnings.push(`Completed, but the end date (${formatDate(row.endDate)}) is in the future`);
  }
  if (row.status === 'To Do' && row.endDate && row.endDate < today) {
    warnings.push(`Still To Do, but the end date (${formatDate(row.endDate)}) has passed`);
  }
  return warnings;
}

// key -> [phases it overlaps]. Every pair in the same module; touching on
// the same day is not an overlap; rows missing a date are left out.
export function overlapsByRow(rows) {
  const byModule = new Map();
  for (const r of rows) {
    if (!r.startDate || !r.endDate) continue;
    const m = nameKey(r.module);
    if (!byModule.has(m)) byModule.set(m, []);
    byModule.get(m).push(r);
  }
  const result = new Map();
  let pairs = 0;
  const add = (r, other) => {
    if (!result.has(r.key)) result.set(r.key, []);
    result.get(r.key).push(other);
  };
  for (const group of byModule.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.startDate < b.endDate && b.startDate < a.endDate) {
          add(a, b);
          add(b, a);
          pairs += 1;
        }
      }
    }
  }
  return { byRow: result, pairs };
}

// Rows grouped by module, in the order modules first appear.
export function groupByModule(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = nameKey(r.module) || '';
    if (!groups.has(k)) groups.set(k, { key: k, name: tidyName(r.module) || 'Untitled module', rows: [] });
    groups.get(k).rows.push(r);
  }
  return [...groups.values()];
}

export function dateRange(start, end) {
  if (!start && !end) return 'No dates';
  return `${start ? formatDate(start) : '—'} – ${end ? formatDate(end) : '—'}`;
}

export function formatFor(fileName) {
  const ext = String(fileName).split('.').pop().toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  return null;
}
