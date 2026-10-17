// Project Timeline - risk score per phase and team load per week
// (2026-10-17). Pure functions on the page's rows (unsaved edits
// included), so both follow every edit. Read-only: nothing here changes a
// date or a status.

import { addDaysIso, isOverdue } from './projectTimeline';
import { NO_TEAM, daysBetween, isRunningLate, isRunningNow } from './projectTimelineSummary';

// Score bands, lowest first. A score is 0-100.
export const RISK_LEVELS = [
  { key: 'low', label: 'Low', min: 0 },
  { key: 'medium', label: 'Medium', min: 25 },
  { key: 'high', label: 'High', min: 50 },
  { key: 'critical', label: 'Critical', min: 75 },
];

export const levelFor = (score) => [...RISK_LEVELS].reverse().find((l) => score >= l.min);

// What adds to the score, in points (shown on the page as "How risk
// works"). Several can apply; the total is capped at 100.
export const RISK_RULES = [
  ['Overdue (To Do, end date passed)', '40, plus 1 for every 3 days late (up to 10 more)'],
  ['Delayed, or In Progress past its end date', '30'],
  ['Should have started (To Do, start date passed)', '15'],
  ['On Hold', '10'],
  ['Forecast finishes after its end date', '1 per day late (up to 25)'],
  ['End date moved later than the plan (baseline)', '1 per 2 days (up to 15)'],
  ['Starts before a phase it depends on allows', '15'],
  ['Status doesn’t match its tickets', '10 per mismatch (up to 15)'],
  ['On the critical path', 'everything above × 1.2'],
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ctx: { today, forecastByKey: key -> { end, done }, slipByKey: key -> { slip },
//        ticketInfoById: id -> { mismatches }, earlyById: id -> days,
//        criticalIds: Set of ids }
export function phaseRisk(r, ctx) {
  const reasons = [];
  const add = (points, text) => points > 0 && reasons.push({ points: Math.round(points), text });
  if (r.status === 'Completed') return { score: 0, level: RISK_LEVELS[0], reasons };
  const { today } = ctx;

  if (isOverdue(r, today)) {
    const late = daysBetween(r.endDate, today);
    add(40 + Math.min(10, Math.floor(late / 3)), `overdue ${plural(late, 'day')}`);
  }
  if (r.status === 'Delayed') add(30, 'marked Delayed');
  else if (isRunningLate(r, today)) add(30, `In Progress past its end date (${plural(daysBetween(r.endDate, today), 'day')})`);
  if (r.status === 'To Do' && isRunningNow(r, today)) add(15, 'should have started');
  if (r.status === 'On Hold') add(10, 'On Hold');

  const f = ctx.forecastByKey?.get(r.key);
  if (f && !f.done && f.end && r.endDate && f.end > r.endDate) {
    const d = daysBetween(r.endDate, f.end);
    add(Math.min(25, d), `forecast ${plural(d, 'day')} late`);
  }
  const slip = ctx.slipByKey?.get(r.key)?.slip;
  if (slip > 0) add(Math.min(15, Math.ceil(slip / 2)), `end moved ${plural(slip, 'day')} later than plan`);
  const early = r.id != null ? ctx.earlyById?.get(r.id) : null;
  if (early > 0) add(15, `starts ${plural(early, 'day')} before a phase it depends on allows`);
  const mismatches = r.id != null ? ctx.ticketInfoById?.get(r.id)?.mismatches?.length || 0 : 0;
  if (mismatches) add(Math.min(15, mismatches * 10), mismatches === 1 ? 'status doesn’t match its tickets' : `${mismatches} ticket mismatches`);

  let score = reasons.reduce((n, x) => n + x.points, 0);
  const critical = r.id != null && ctx.criticalIds?.has(r.id);
  if (critical && score > 0) {
    const bonus = Math.round(score * 0.2);
    score += bonus;
    reasons.push({ points: bonus, text: 'on the critical path' });
  }
  score = Math.min(100, score);
  return { score, level: levelFor(score), reasons };
}

// key -> risk, for every row.
export function riskByKey(rows, ctx) {
  return new Map(rows.map((r) => [r.key, phaseRisk(r, ctx)]));
}

// The riskiest phases first (ties: earlier end date, then plan order).
export function topRisks(rows, risks, limit = 6) {
  return rows
    .filter((r) => risks.get(r.key)?.score > 0)
    .sort((a, b) => risks.get(b.key).score - risks.get(a.key).score || String(a.endDate || '9').localeCompare(String(b.endDate || '9')) || a.sortOrder - b.sortOrder)
    .slice(0, limit)
    .map((r) => ({ row: r, ...risks.get(r.key) }));
}

// Count per level, for the Overview.
export function riskCounts(rows, risks) {
  const out = Object.fromEntries(RISK_LEVELS.map((l) => [l.key, 0]));
  for (const r of rows) if (r.status !== 'Completed') out[risks.get(r.key).level.key] += 1;
  return out;
}

// ---------------------------------------------------------- team load

// Monday of the week `iso` falls in.
export function weekStart(iso) {
  const wd = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysIso(iso, -wd);
}

// Unfinished phases (both dates) running in each week, per team, from
// `before` weeks ago for `weeks` weeks. A phase counts in every week it
// overlaps. teams: the Team list.
export function teamLoad(rows, teams, today, { weeks = 16, before = 2 } = {}) {
  const first = addDaysIso(weekStart(today), -7 * before);
  const cols = Array.from({ length: weeks }, (_, i) => {
    const start = addDaysIso(first, 7 * i);
    return { start, end: addDaysIso(start, 6), current: start === weekStart(today) };
  });
  const name = new Map(teams.map((t) => [t.id, t.name]));
  const byTeam = new Map();
  for (const r of rows) {
    if (r.status === 'Completed' || !r.startDate || !r.endDate) continue;
    const key = r.teamId != null ? String(r.teamId) : NO_TEAM;
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(r);
  }
  const out = [...byTeam.entries()]
    .map(([key, list]) => ({
      key,
      name: key === NO_TEAM ? 'No team' : name.get(Number(key)) || `Team #${key}`,
      cells: cols.map((c) => {
        const running = list.filter((r) => r.startDate <= c.end && r.endDate >= c.start);
        return { count: running.length, rows: running };
      }),
    }))
    .map((t) => ({ ...t, peak: Math.max(0, ...t.cells.map((c) => c.count)) }))
    .sort((a, b) => (a.key === NO_TEAM) - (b.key === NO_TEAM) || a.name.localeCompare(b.name));
  return { weeks: cols, teams: out, peak: Math.max(0, ...out.map((t) => t.peak)) };
}
