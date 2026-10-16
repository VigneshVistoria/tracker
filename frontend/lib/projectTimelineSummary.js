import { formatDate } from './formatDate';
import { addDaysIso, isOverdue, nameKey, tidyName } from './projectTimeline';

// Project Timeline Summary (2026-10-16) - every number on the Summary
// section, worked out from the same rows the table shows (no API of its
// own). Pure: rows + teams + today (YYYY-MM-DD, team time zone) in, plain
// data out, so it is easy to check against SQL. Each phase is counted once.

export const STATUS_KEYS = ['Completed', 'In Progress', 'To Do', 'Delayed', 'On Hold'];
export const ATTENTION_PREVIEW = 6;
export const SOON_DAYS = 14;
export const LATE_DAYS = 14;
export const LATE_COUNT = 3;
export const NO_TEAM = 'none';

// Shown on the page as "How health works" - keep in step with moduleHealth().
export const HEALTH_RULES = [
  ['Done', 'every phase is Completed'],
  ['Late', `a phase is overdue by more than ${LATE_DAYS} days, or ${LATE_COUNT} or more phases are overdue`],
  ['At risk', 'any phase is overdue or Delayed, an In Progress phase is past its end date, or the start date has passed but nothing has started'],
  ['Not started', 'nothing has started yet and the start date is still ahead'],
  ['On track', 'everything else'],
];

export const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);

// Today falls between its start and end dates (inclusive) and it isn't Completed.
export const isRunningNow = (r, today) => r.status !== 'Completed' && !!r.startDate && !!r.endDate && r.startDate <= today && today <= r.endDate;
export const isStartingSoon = (r, today) => r.status !== 'Completed' && !!r.startDate && r.startDate > today && r.startDate <= addDaysIso(today, SOON_DAYS);
export const isRunningLate = (r, today) => r.status === 'In Progress' && !!r.endDate && r.endDate < today;
const hasStarted = (r) => r.status !== 'To Do';

function counts(rows, today) {
  const by = Object.fromEntries(STATUS_KEYS.map((s) => [s, 0]));
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  const overdue = rows.filter((r) => isOverdue(r, today));
  return {
    total: rows.length,
    completed: by.Completed,
    inProgress: by['In Progress'],
    toDo: by['To Do'],
    delayed: by.Delayed,
    onHold: by['On Hold'],
    overdue: overdue.length,
    pct: rows.length ? Math.round((by.Completed / rows.length) * 100) : 0,
    overdueRows: overdue,
  };
}

export function moduleHealth(rows, today) {
  const c = counts(rows, today);
  const daysLate = c.overdueRows.map((r) => daysBetween(r.endDate, today));
  const starts = rows.map((r) => r.startDate).filter(Boolean).sort();
  const anyStarted = rows.some(hasStarted);
  if (c.total > 0 && c.completed === c.total) return 'Done';
  if (daysLate.some((d) => d > LATE_DAYS) || c.overdue >= LATE_COUNT) return 'Late';
  if (c.overdue > 0 || c.delayed > 0 || rows.some((r) => isRunningLate(r, today)) || (!anyStarted && starts[0] && starts[0] <= today)) return 'At risk';
  if (!anyStarted) return 'Not started';
  return 'On track';
}

// What the module is doing: its In Progress phase (flagged if past its
// end date), else a phase running by dates, else the next to start.
function nowOrNext(rows, today) {
  const inProgress = rows.find((r) => r.status === 'In Progress');
  if (inProgress) {
    return isRunningLate(inProgress, today)
      ? { kind: 'late', row: inProgress, text: `Running late: ${inProgress.phase} (ended ${formatDate(inProgress.endDate)})` }
      : { kind: 'now', row: inProgress, text: `Now: ${inProgress.phase}` };
  }
  const running = rows.find((r) => isRunningNow(r, today));
  if (running) return { kind: 'now', row: running, text: `Now: ${running.phase} (until ${formatDate(running.endDate)})` };
  const next = rows
    .filter((r) => r.status !== 'Completed' && r.startDate && r.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.sortOrder - b.sortOrder)[0];
  if (next) return { kind: 'next', row: next, text: `Next: ${next.phase} (starts ${formatDate(next.startDate)})` };
  return { kind: 'none', row: null, text: 'No upcoming phases' };
}

function span(rows) {
  const starts = rows.map((r) => r.startDate).filter(Boolean).sort();
  const ends = rows.map((r) => r.endDate).filter(Boolean).sort();
  return { start: starts[0] || null, end: ends[ends.length - 1] || null };
}

const byDaysLate = (today) => (a, b) => daysBetween(a.endDate, today) - daysBetween(b.endDate, today);

// rows: live (not deleted) rows, sorted as in the table; teams: the Team list.
export function computeSummary(rows, teams, today) {
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const teamOf = (r) => (r.teamId != null ? String(r.teamId) : NO_TEAM);
  const overall = { ...counts(rows, today), ...span(rows) };

  const moduleGroups = new Map();
  for (const r of rows) {
    const key = nameKey(r.module);
    if (!moduleGroups.has(key)) moduleGroups.set(key, { key, name: tidyName(r.module) || 'Untitled module', rows: [] });
    moduleGroups.get(key).rows.push(r);
  }
  const modules = [...moduleGroups.values()].map((m) => {
    const c = counts(m.rows, today);
    return { key: m.key, name: m.name, rows: m.rows, ...c, ...span(m.rows), health: moduleHealth(m.rows, today), status: nowOrNext(m.rows, today) };
  });

  const teamGroups = new Map();
  for (const r of rows) {
    const key = teamOf(r);
    if (!teamGroups.has(key)) teamGroups.set(key, []);
    teamGroups.get(key).push(r);
  }
  const teamCards = [...teamGroups.entries()]
    .map(([key, list]) => {
      const c = counts(list, today);
      const oldest = [...c.overdueRows].sort(byDaysLate(today)).reverse()[0] || null;
      return {
        key,
        name: key === NO_TEAM ? 'No team' : teamName.get(Number(key)) || `Team #${key}`,
        ...c,
        runningNow: list.filter((r) => isRunningNow(r, today)).length,
        runningNowToDo: list.filter((r) => isRunningNow(r, today) && r.status === 'To Do').length,
        startingSoon: list.filter((r) => isStartingSoon(r, today)).length,
        oldestOverdue: oldest ? { row: oldest, daysLate: daysBetween(oldest.endDate, today) } : null,
      };
    })
    .sort((a, b) => (a.key === NO_TEAM) - (b.key === NO_TEAM) || a.name.localeCompare(b.name));

  // Module x Team: overdue / total per cell.
  const grid = modules.map((m) => ({
    module: m,
    cells: teamCards.map((t) => {
      const list = moduleGroups.get(m.key).rows.filter((r) => teamOf(r) === t.key);
      return { team: t, total: list.length, overdue: list.filter((r) => isOverdue(r, today)).length };
    }),
  }));

  const attention = [...overall.overdueRows]
    .sort((a, b) => byDaysLate(today)(b, a) || a.sortOrder - b.sortOrder)
    .map((r) => ({ row: r, daysLate: daysBetween(r.endDate, today), team: r.teamId != null ? teamName.get(r.teamId) || null : null }));
  const runningLate = rows.filter((r) => isRunningLate(r, today));

  const sum = (list, f) => list.reduce((n, x) => n + x[f], 0);
  const totals = {
    overall: overall.total,
    modules: sum(modules, 'total'),
    teams: sum(teamCards, 'total'),
    overdue: overall.overdue,
    modulesOverdue: sum(modules, 'overdue'),
    teamsOverdue: sum(teamCards, 'overdue'),
  };
  totals.ok = totals.modules === totals.overall && totals.teams === totals.overall && totals.modulesOverdue === totals.overdue && totals.teamsOverdue === totals.overdue;

  return { today, overall, modules, teams: teamCards, grid, attention, runningLate, totals };
}

// Plain text for pasting into Teams.
export function summaryText(summary, projectName) {
  const { overall, modules, teams, attention, runningLate, today } = summary;
  const lines = [
    `${projectName} – Project Timeline, ${formatDate(today)}`,
    `Overall: ${overall.completed}/${overall.total} completed (${overall.pct}%) · ${overall.overdue} overdue · ${overall.delayed} delayed`,
    '',
    'Modules:',
    ...modules.map((m) => `• ${m.name}: ${m.completed}/${m.total} completed · ${m.overdue} overdue · ${m.health}`),
    '',
    'Teams:',
    ...teams.map((t) => `• ${t.name}: ${t.completed}/${t.total} completed · ${t.inProgress} in progress · ${t.overdue} overdue${t.delayed ? ` · ${t.delayed} delayed` : ''}`),
  ];
  if (attention.length) {
    lines.push('', 'Needs attention:');
    for (const a of attention.slice(0, ATTENTION_PREVIEW)) {
      lines.push(`• ${a.row.module} – ${a.row.phase}${a.team ? ` (${a.team})` : ''}: ${a.daysLate} day${a.daysLate === 1 ? '' : 's'} late`);
    }
    if (attention.length > ATTENTION_PREVIEW) lines.push(`• …and ${attention.length - ATTENTION_PREVIEW} more overdue`);
  }
  if (runningLate.length) {
    lines.push('', `Running late (In Progress, past end date): ${runningLate.map((r) => `${r.module} – ${r.phase}`).join('; ')}`);
  }
  return lines.join('\n');
}

// ------------------------------------------------------------- filters

export const EMPTY_FILTERS = { team: '', status: '', module: '', from: '', to: '', search: '' };

// Status filter values beyond the five statuses.
export const FLAG_FILTERS = [
  ['overdue', 'Overdue (To Do, end date passed)'],
  ['running', 'Running now'],
  ['soon', `Starting in the next ${SOON_DAYS} days`],
  ['late', 'Running late (In Progress, past end date)'],
];

export const isFiltering = (f) => Object.values(f).some((v) => v !== '');

export function matchesFilters(r, f, teamName, today) {
  if (f.module && nameKey(r.module) !== f.module) return false;
  if (f.team && (r.teamId != null ? String(r.teamId) : NO_TEAM) !== f.team) return false;
  if (f.status) {
    if (f.status === 'overdue' && !isOverdue(r, today)) return false;
    if (f.status === 'running' && !isRunningNow(r, today)) return false;
    if (f.status === 'soon' && !isStartingSoon(r, today)) return false;
    if (f.status === 'late' && !isRunningLate(r, today)) return false;
    if (STATUS_KEYS.includes(f.status) && r.status !== f.status) return false;
  }
  // Date range: the phase overlaps it (rows without dates drop out).
  if (f.from && (!r.endDate || r.endDate < f.from)) return false;
  if (f.to && (!r.startDate || r.startDate > f.to)) return false;
  if (f.search) {
    const q = f.search.trim().toLowerCase();
    const team = r.teamId != null ? teamName.get(r.teamId) || '' : '';
    if (q && ![r.module, r.phase, team, r.status].some((v) => String(v || '').toLowerCase().includes(q))) return false;
  }
  return true;
}

// ---------------------------------------------------------- status check

// Statuses that don't fit their dates. Each phase is listed under the
// first rule it matches. Fixes only change the page (like an inline edit)
// until Save changes.
export const STATUS_CHECK_RULES = [
  {
    id: 'started',
    title: 'Should have started',
    hint: 'To Do, but today is between its start and end dates',
    match: (r, today) => r.status === 'To Do' && isRunningNow(r, today),
    open: true,
    bulk: { label: 'Mark all In Progress', patch: { status: 'In Progress' } },
    fixes: [{ label: 'Mark In Progress', patch: { status: 'In Progress' } }, { label: 'Change dates', jump: true }],
  },
  {
    id: 'late',
    title: 'Running late',
    hint: 'In Progress, but its end date has passed',
    match: (r, today) => isRunningLate(r, today),
    open: true,
    fixes: [{ label: 'Mark Completed', patch: { status: 'Completed' } }, { label: 'Mark Delayed', patch: { status: 'Delayed' } }, { label: 'Change end date', jump: true }],
  },
  {
    id: 'overdue',
    title: 'Overdue',
    hint: 'To Do, and its end date has passed',
    match: (r, today) => isOverdue(r, today),
    open: false,
    fixes: [
      { label: 'Mark In Progress', patch: { status: 'In Progress' } },
      { label: 'Mark Completed', patch: { status: 'Completed' } },
      { label: 'Mark Delayed', patch: { status: 'Delayed' } },
      { label: 'Change end date', jump: true },
    ],
  },
  {
    id: 'early',
    title: 'Started early?',
    hint: 'In Progress, but its start date is still ahead',
    match: (r, today) => r.status === 'In Progress' && !!r.startDate && r.startDate > today,
    open: true,
    fixes: [{ label: 'Mark To Do', patch: { status: 'To Do' } }, { label: 'Change start date', jump: true }],
  },
  {
    id: 'completedEarly',
    title: 'Completed early?',
    hint: 'Completed, but its dates are in the future',
    match: (r, today) => r.status === 'Completed' && ((!!r.endDate && r.endDate > today) || (!!r.startDate && r.startDate > today)),
    open: true,
    // "Set end date to today" only when that keeps end >= start.
    fixes: [{ label: 'Set end date to today', patch: (r, today) => (!r.startDate || r.startDate <= today ? { endDate: today } : null) }, { label: 'Change dates', jump: true }, { label: 'Leave as is', dismiss: true }],
  },
];

export function statusCheck(rows, today) {
  const groups = STATUS_CHECK_RULES.map((rule) => ({ rule, rows: [] }));
  for (const r of rows) {
    const g = groups.find(({ rule }) => rule.match(r, today));
    if (g) g.rows.push(r);
  }
  return { groups, total: groups.reduce((n, g) => n + g.rows.length, 0) };
}

// ----------------------------------------------------------------- slip

const slipBetween = (from, to) => (from && to ? daysBetween(from, to) : null);
const latest = (dates) => dates.filter(Boolean).sort().pop() || null;

// rows: live rows (draft); slipData: GET /project-timeline/projects/:id/slip.
// Slip = current end date minus baseline end date, in calendar days.
export function computeSlip(rows, slipData) {
  const base = new Map((slipData?.rows || []).map((b) => [b.rowId, b]));
  const perRow = new Map();
  for (const r of rows) {
    const b = r.id != null ? base.get(r.id) : null;
    if (!b) continue;
    perRow.set(r.key, { ...b, slip: slipBetween(b.baselineEnd, r.endDate) });
  }
  const summarize = (list) => {
    const withBase = list.filter((r) => perRow.has(r.key));
    const plannedEnd = latest(withBase.map((r) => perRow.get(r.key).baselineEnd));
    const currentEnd = latest(withBase.map((r) => r.endDate));
    const slips = withBase.map((r) => perRow.get(r.key).slip).filter((s) => s != null);
    return {
      plannedEnd,
      currentEnd,
      slip: slipBetween(plannedEnd, currentEnd),
      later: slips.filter((s) => s > 0).length,
      earlier: slips.filter((s) => s < 0).length,
    };
  };
  const modules = new Map();
  for (const r of rows) {
    const k = nameKey(r.module);
    if (!modules.has(k)) modules.set(k, { key: k, name: tidyName(r.module) || 'Untitled module', rows: [] });
    modules.get(k).rows.push(r);
  }
  const mostSlipped = rows
    .filter((r) => (perRow.get(r.key)?.slip ?? 0) > 0)
    .sort((a, b) => perRow.get(b.key).slip - perRow.get(a.key).slip || a.sortOrder - b.sortOrder)
    .slice(0, 5)
    .map((r) => ({ row: r, ...perRow.get(r.key) }));
  const overall = summarize(rows);
  return {
    perRow,
    overall,
    modules: [...modules.values()].map((m) => ({ key: m.key, name: m.name, ...summarize(m.rows) })),
    mostSlipped,
    anyMoved: overall.later + overall.earlier > 0 || (overall.slip ?? 0) !== 0,
    baselineFrom: slipData?.baselineFrom || null,
    resets: slipData?.resets || [],
  };
}

export const formatSlip = (d) => (d == null ? '—' : d === 0 ? '0d' : `${d > 0 ? '+' : '−'}${Math.abs(d)}d`);
