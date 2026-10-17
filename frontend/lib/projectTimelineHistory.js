// Project Timeline - time travel (2026-10-17). Rebuilds the saved plan as
// it stood at the end of a past day (team time zone) from the change
// history (GET projects/:id/history, see backend
// project-timeline-history.ts): start from today's saved rows and undo,
// newest first, every change made after that day.

import { addDaysIso } from './projectTimeline';

const FIELDS = ['module', 'phase', 'team', 'status', 'startDate', 'endDate', 'order'];

// rows: today's saved rows (plan.rows); teams: the Team list; events:
// history events, oldest first; day: 'YYYY-MM-DD'.
export function planAt(rows, teams, events, day) {
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const teamId = new Map(teams.map((t) => [t.name, t.id]));
  const state = new Map(
    rows.map((r) => [
      r.id,
      { module: r.module, phase: r.phase, team: r.teamId != null ? teamName.get(r.teamId) ?? null : null, status: r.status, startDate: r.startDate || null, endDate: r.endDate || null, order: r.sortOrder },
    ]),
  );
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.day <= day) break;
    if (e.kind === 'created') state.delete(e.rowId);
    else if (e.kind === 'deleted') state.set(e.rowId, Object.fromEntries(FIELDS.map((f) => [f, e.values?.[f] ?? null])));
    else if (e.kind === 'updated' && state.has(e.rowId)) {
      const cur = { ...state.get(e.rowId) };
      for (const [f, c] of Object.entries(e.changes || {})) if (FIELDS.includes(f)) cur[f] = c.old ?? null;
      state.set(e.rowId, cur);
    }
  }
  return [...state.entries()]
    .map(([id, v]) => ({
      key: `id-${id}`,
      id,
      module: v.module || '',
      phase: v.phase || '',
      teamId: v.team != null ? teamId.get(v.team) ?? null : null,
      status: v.status || 'To Do',
      startDate: v.startDate || null,
      endDate: v.endDate || null,
      sortOrder: v.order ?? 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

// Every calendar day from the first change (or `fallback`) to today.
export function historyDays(events, today) {
  const first = events.length && events[0].day < today ? events[0].day : today;
  const days = [];
  for (let d = first; d <= today; d = addDaysIso(d, 1)) days.push(d);
  return days;
}

// Days that have at least one change, oldest first.
export function changeDays(events) {
  return [...new Set(events.map((e) => e.day))].sort();
}
