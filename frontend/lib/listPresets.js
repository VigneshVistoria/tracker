// Dashboard card -> list links (2026-11-04, user feedback: a card's
// number must match the rows of the list it opens). Each list page reads
// its preset from the URL on first load (?card=..., plus a period or a
// status where the card needs one) and keeps the URL in step with its own
// cards/filters afterwards, so a reload or a shared link shows the same
// rows. Pure helpers only - no React, no router - so they're unit-tested
// in lib/__tests__/listPresets.test.mjs.

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date in YYYY-MM-DD form, or null.
export function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

// router.query values can be arrays (?card=a&card=b) - take the first.
const first = (v) => (Array.isArray(v) ? v[0] : v);

// The card key from the query, if it's one this page knows.
export function readCardParam(query, allowedKeys) {
  const card = first(query?.card);
  return typeof card === 'string' && allowedKeys.includes(card) ? card : null;
}

// Passed testing period: completedAt from/to (inclusive, UTC days - the
// backend's day boundary). Either may be missing; both invalid -> null.
export function readPassedParams(query) {
  const from = parseDateOnly(first(query?.passedFrom));
  const to = parseDateOnly(first(query?.passedTo));
  if (!from && !to) return null;
  return { passedFrom: from || '', passedTo: to || '' };
}

const iso = (d) => d.toISOString().slice(0, 10);

// Leadership dashboard's period control for the Passed testing card.
// Weeks run Monday-Sunday (same as Team Tasks' Workload view); dates are
// UTC, matching todayISO() and the backend.
export const PASSED_PERIODS = [
  { key: 'thisWeek', label: 'This week' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
];
export const DEFAULT_PASSED_PERIOD = 'thisMonth';

export function passedPeriodRange(key, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (key === 'thisWeek') {
    const day = now.getUTCDay(); // 0 = Sunday
    const monday = new Date(Date.UTC(y, m, now.getUTCDate() - (day === 0 ? 6 : day - 1)));
    const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6));
    return { passedFrom: iso(monday), passedTo: iso(sunday) };
  }
  if (key === 'lastMonth') {
    return { passedFrom: iso(new Date(Date.UTC(y, m - 1, 1))), passedTo: iso(new Date(Date.UTC(y, m, 0))) };
  }
  return { passedFrom: iso(new Date(Date.UTC(y, m, 1))), passedTo: iso(new Date(Date.UTC(y, m + 1, 0))) };
}

// "/path?a=1&b=2", leaving out empty values.
export function buildHref(pathname, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${pathname}?${s}` : pathname;
}

// The query a list page should show for its current state: the known
// preset keys are replaced, anything else already in the URL is kept.
export function syncedQuery(query, presetKeys, values) {
  const next = {};
  for (const [k, v] of Object.entries(query || {})) if (!presetKeys.includes(k)) next[k] = v;
  for (const k of presetKeys) if (values[k]) next[k] = values[k];
  return next;
}

export function sameQuery(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) if (String(first(a?.[k]) ?? '') !== String(first(b?.[k]) ?? '')) return false;
  return true;
}

// Issues list (?status=): one issue status, or a named group of them -
// the client dashboard's "In progress" tile covers four stages.
export const ISSUE_STATUS_GROUPS = {
  'in-progress': { label: 'In progress (any stage)', statuses: ['In Progress', 'In Review', 'QA Testing', 'QA Failed'] },
};

export function readIssueStatusParam(query, statusOptions) {
  const v = first(query?.status);
  if (typeof v !== 'string') return null;
  if (ISSUE_STATUS_GROUPS[v] || statusOptions.includes(v)) return v;
  return null;
}

export function issueMatchesStatus(issue, statusFilter) {
  if (!statusFilter || statusFilter === 'All') return true;
  const group = ISSUE_STATUS_GROUPS[statusFilter];
  return group ? group.statuses.includes(issue.status) : issue.status === statusFilter;
}
