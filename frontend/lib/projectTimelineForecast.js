// Project Timeline Stage D (2026-10-16) - the page-side copy of
// backend/src/project-timeline/project-timeline-forecast.ts (tested
// there; see the rules at the top of that file), run on the page's
// unsaved dates and statuses so the forecast follows every edit. Keep the
// two in step. Rows need an id - the page gives unsaved rows a stand-in.

import { addDaysIso } from './projectTimeline';
import { daysFromTo, earliestStart, topoOrder } from './projectTimelineDeps';

const NOT_STARTED = ['To Do', 'On Hold'];
const STARTED = ['In Progress', 'Delayed'];
const later = (a, b) => (a > b ? a : b);

function ownForecast(r, today, pace) {
  const plannedEnd = r.endDate;
  const plannedStart = r.startDate ?? plannedEnd;
  const length = daysFromTo(plannedStart, plannedEnd);
  if (r.status === 'Completed') return { id: r.id, plannedEnd, start: r.startDate, end: plannedEnd, done: true, reasons: [] };

  const reasons = [];
  let start = plannedStart;
  let end = plannedEnd;
  const started = STARTED.includes(r.status);
  if (NOT_STARTED.includes(r.status) && plannedStart < today) {
    start = today;
    end = addDaysIso(today, length);
    reasons.push({ code: 'late_start' });
  }
  if (started && pace && pace.counted > 0 && pace.percent != null && pace.percent > 0 && pace.percent < 100 && plannedStart <= today) {
    const elapsedDays = daysFromTo(plannedStart, today) + 1;
    const paceEnd = addDaysIso(plannedStart, Math.ceil((elapsedDays * 100) / pace.percent) - 1);
    if (paceEnd > end) {
      end = paceEnd;
      reasons.push({ code: 'ticket_pace', percent: pace.percent, elapsedDays });
    }
  }
  if (end < today) {
    end = today;
    reasons.push({ code: 'overdue' });
  }
  return { id: r.id, plannedEnd, start: r.startDate ? start : null, end, done: false, reasons };
}

export function forecastPlan(rows, deps, today, paceByRow = new Map()) {
  const dated = rows.filter((r) => r.endDate);
  const byId = new Map(dated.map((r) => [r.id, ownForecast(r, today, paceByRow.get(r.id))]));
  const rowById = new Map(dated.map((r) => [r.id, r]));
  const preds = new Map();
  for (const d of deps) {
    if (!preds.has(d.successorRowId)) preds.set(d.successorRowId, []);
    preds.get(d.successorRowId).push(d);
  }
  for (const id of topoOrder([...byId.keys()], deps)) {
    const f = byId.get(id);
    const status = rowById.get(id).status;
    if (f.done || !NOT_STARTED.includes(status)) continue;
    const start = f.start ?? f.end;
    let required = null;
    let waitsOn = null;
    for (const d of preds.get(id) || []) {
      const p = byId.get(d.predecessorRowId);
      if (!p) continue;
      const e = earliestStart(p.end, d.lagDays);
      if (!required || e > required) {
        required = e;
        waitsOn = d.predecessorRowId;
      }
    }
    if (!required || required <= start) continue;
    const days = daysFromTo(start, required);
    f.start = f.start ? required : null;
    f.end = addDaysIso(f.end, days);
    f.reasons = [...f.reasons.filter((x) => x.code !== 'overdue'), { code: 'waits_on', rowId: waitsOn }];
  }

  const out = dated.map((r) => {
    const f = byId.get(r.id);
    return { ...f, slipDays: daysFromTo(f.plannedEnd, f.end) };
  });
  if (!out.length) return { today, plannedEnd: null, likelyEnd: null, slipDays: null, drivers: [], rows: out };
  const plannedEnd = out.reduce((m, f) => later(m, f.plannedEnd), out[0].plannedEnd);
  const likelyEnd = out.reduce((m, f) => later(m, f.end), out[0].end);
  const order = new Map(rows.map((r, i) => [r.id, r.sortOrder ?? i]));
  const last = out.filter((f) => f.end === likelyEnd).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0))[0];
  const drivers = [last.id];
  for (let cur = last; ; ) {
    const w = cur.reasons.find((x) => x.code === 'waits_on');
    if (!w || drivers.includes(w.rowId)) break;
    drivers.unshift(w.rowId);
    cur = out.find((f) => f.id === w.rowId);
  }
  return { today, plannedEnd, likelyEnd, slipDays: daysFromTo(plannedEnd, likelyEnd), drivers, rows: out };
}
