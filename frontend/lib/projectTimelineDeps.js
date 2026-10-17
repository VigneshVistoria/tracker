// Project Timeline Stage B (2026-10-16) - the page-side copy of
// backend/src/project-timeline/project-timeline-dependencies.ts (tested
// there), run on the page's unsaved dates so conflicts, "shift them too"
// and the critical path follow every edit before it's saved. Keep the two
// in step. Rows are matched by saved id - a phase must be saved before it
// can have links.

import { addDaysIso } from './projectTimeline';

const DAY_MS = 86400000;
export function daysFromTo(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function earliestStart(predEnd, lagDays) {
  return addDaysIso(predEnd, 1 + (lagDays || 0));
}

export function wouldCreateCycle(deps, predecessorRowId, successorRowId) {
  if (predecessorRowId === successorRowId) return true;
  const next = new Map();
  for (const d of deps) {
    if (!next.has(d.predecessorRowId)) next.set(d.predecessorRowId, []);
    next.get(d.predecessorRowId).push(d.successorRowId);
  }
  const seen = new Set();
  const stack = [successorRowId];
  while (stack.length) {
    const id = stack.pop();
    if (id === predecessorRowId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of next.get(id) || []) stack.push(n);
  }
  return false;
}

export function dependencyConflicts(rows, deps) {
  const byId = new Map(rows.filter((r) => r.id != null).map((r) => [r.id, r]));
  const out = [];
  for (const dep of deps) {
    const predecessor = byId.get(dep.predecessorRowId);
    const successor = byId.get(dep.successorRowId);
    if (!predecessor?.endDate || !successor?.startDate) continue;
    const earliest = earliestStart(predecessor.endDate, dep.lagDays);
    if (successor.startDate < earliest) out.push({ dep, predecessor, successor, earliest, daysEarly: daysFromTo(successor.startDate, earliest) });
  }
  return out;
}

export function topoOrder(ids, deps) {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const next = new Map();
  for (const d of deps) {
    if (!indeg.has(d.predecessorRowId) || !indeg.has(d.successorRowId)) continue;
    indeg.set(d.successorRowId, indeg.get(d.successorRowId) + 1);
    if (!next.has(d.predecessorRowId)) next.set(d.predecessorRowId, []);
    next.get(d.predecessorRowId).push(d.successorRowId);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const n of next.get(id) || []) {
      indeg.set(n, indeg.get(n) - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  return order;
}

// [{ id, days, startDate, endDate }] - later only, lengths kept.
export function cascadeShifts(rows, deps) {
  const saved = rows.filter((r) => r.id != null);
  const dates = new Map(saved.map((r) => [r.id, { startDate: r.startDate, endDate: r.endDate }]));
  const preds = new Map();
  for (const d of deps) {
    if (!preds.has(d.successorRowId)) preds.set(d.successorRowId, []);
    preds.get(d.successorRowId).push(d);
  }
  const shifts = new Map();
  for (const id of topoOrder(saved.map((r) => r.id), deps)) {
    const own = dates.get(id);
    if (!own.startDate) continue;
    let required = null;
    for (const d of preds.get(id) || []) {
      const pEnd = dates.get(d.predecessorRowId)?.endDate;
      if (!pEnd) continue;
      const e = earliestStart(pEnd, d.lagDays);
      if (!required || e > required) required = e;
    }
    if (!required || own.startDate >= required) continue;
    const days = daysFromTo(own.startDate, required);
    const moved = { startDate: required, endDate: own.endDate ? addDaysIso(own.endDate, days) : null };
    dates.set(id, moved);
    shifts.set(id, { id, days, ...moved });
  }
  return [...shifts.values()];
}

// { projectEnd, chain: [ids, start to finish] }
export function criticalPath(rows, deps) {
  const saved = rows.filter((r) => r.id != null);
  const dated = saved.filter((r) => r.endDate);
  if (!dated.length) return { projectEnd: null, chain: [] };
  const byId = new Map(saved.map((r) => [r.id, r]));
  const last = [...dated].sort((a, b) => (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id))[0];
  const preds = new Map();
  for (const d of deps) {
    if (!preds.has(d.successorRowId)) preds.set(d.successorRowId, []);
    preds.get(d.successorRowId).push(d);
  }
  const chain = [last.id];
  const seen = new Set(chain);
  let current = last;
  for (;;) {
    if (!current.startDate) break;
    let driver = null;
    let driverEarliest = '';
    for (const d of preds.get(current.id) || []) {
      const p = byId.get(d.predecessorRowId);
      if (!p?.endDate || seen.has(p.id)) continue;
      const e = earliestStart(p.endDate, d.lagDays);
      if (e >= current.startDate && (!driver || e > driverEarliest)) {
        driver = p;
        driverEarliest = e;
      }
    }
    if (!driver) break;
    chain.unshift(driver.id);
    seen.add(driver.id);
    current = driver;
  }
  return { projectEnd: last.endDate, chain };
}
