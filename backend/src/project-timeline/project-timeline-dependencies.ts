// Project Timeline Stage B (2026-10-16): dependency rules. Pure (no
// Nest/TypeORM) so they can be tested directly; the page keeps a copy in
// frontend/lib/projectTimelineDeps.js (it runs them on unsaved dates) -
// keep the two in step.
//
// Rules confirmed with the user:
// - Finish-to-start only: the successor may start the day after the
//   predecessor ends, plus lagDays calendar days (0-365).
// - Links may cross modules; a link can never close a loop.
// - Nothing moves by itself. A successor starting too early is a
//   "conflict"; cascadeShifts() proposes moving it (and anything after
//   it) later, keeping each phase's length, for the PM to accept.
// - Critical path (with the dates as they are): from the phase that ends
//   last, walk back through the predecessor that leaves it no slack (its
//   finish + gap reaches this phase's start), until none does.

import { addDays } from './project-timeline-rules';

export const MAX_LAG_DAYS = 365;

export interface DepRow {
  id: number;
  startDate: string | null;
  endDate: string | null;
  sortOrder?: number;
}

export interface Dep {
  predecessorRowId: number;
  successorRowId: number;
  lagDays: number;
}

const DAY_MS = 86400000;
export function daysFromTo(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

// The first day the successor may start.
export function earliestStart(predEnd: string, lagDays: number): string {
  return addDays(predEnd, 1 + (lagDays || 0));
}

// Would adding pred -> succ close a loop? (Also true for a self-link.)
export function wouldCreateCycle(deps: Dep[], predecessorRowId: number, successorRowId: number): boolean {
  if (predecessorRowId === successorRowId) return true;
  const next = new Map<number, number[]>();
  for (const d of deps) {
    if (!next.has(d.predecessorRowId)) next.set(d.predecessorRowId, []);
    next.get(d.predecessorRowId)!.push(d.successorRowId);
  }
  // A loop exists if the new successor can already reach the predecessor.
  const seen = new Set<number>();
  const stack = [successorRowId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === predecessorRowId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of next.get(id) || []) stack.push(n);
  }
  return false;
}

export interface Conflict<R extends DepRow> {
  dep: Dep;
  predecessor: R;
  successor: R;
  earliest: string;
  daysEarly: number;
}

// Every link whose successor starts before its predecessor allows. Links
// where either date is missing can't conflict.
export function dependencyConflicts<R extends DepRow>(rows: R[], deps: Dep[]): Conflict<R>[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Conflict<R>[] = [];
  for (const dep of deps) {
    const predecessor = byId.get(dep.predecessorRowId);
    const successor = byId.get(dep.successorRowId);
    if (!predecessor?.endDate || !successor?.startDate) continue;
    const earliest = earliestStart(predecessor.endDate, dep.lagDays);
    if (successor.startDate < earliest) out.push({ dep, predecessor, successor, earliest, daysEarly: daysFromTo(successor.startDate, earliest) });
  }
  return out;
}

// Rows in an order where every predecessor comes before its successors
// (rows in a loop - which the service never allows - are left out).
export function topoOrder(ids: number[], deps: Dep[]): number[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const next = new Map<number, number[]>();
  for (const d of deps) {
    if (!indeg.has(d.predecessorRowId) || !indeg.has(d.successorRowId)) continue;
    indeg.set(d.successorRowId, indeg.get(d.successorRowId)! + 1);
    if (!next.has(d.predecessorRowId)) next.set(d.predecessorRowId, []);
    next.get(d.predecessorRowId)!.push(d.successorRowId);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: number[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const n of next.get(id) || []) {
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  return order;
}

export interface Shift {
  id: number;
  days: number;
  startDate: string;
  endDate: string | null;
}

// The moves that clear every conflict: each phase that starts too early
// moves later by just enough, keeping its length, and the move flows on
// to whatever depends on it. Only ever later, never earlier.
export function cascadeShifts(rows: DepRow[], deps: Dep[]): Shift[] {
  const dates = new Map(rows.map((r) => [r.id, { startDate: r.startDate, endDate: r.endDate }]));
  const preds = new Map<number, Dep[]>();
  for (const d of deps) {
    if (!preds.has(d.successorRowId)) preds.set(d.successorRowId, []);
    preds.get(d.successorRowId)!.push(d);
  }
  const shifts = new Map<number, Shift>();
  for (const id of topoOrder(rows.map((r) => r.id), deps)) {
    const own = dates.get(id)!;
    if (!own.startDate) continue;
    let required: string | null = null;
    for (const d of preds.get(id) || []) {
      const pEnd = dates.get(d.predecessorRowId)?.endDate;
      if (!pEnd) continue;
      const e = earliestStart(pEnd, d.lagDays);
      if (!required || e > required) required = e;
    }
    if (!required || own.startDate >= required) continue;
    const days = daysFromTo(own.startDate, required);
    const moved = { startDate: required, endDate: own.endDate ? addDays(own.endDate, days) : null };
    dates.set(id, moved);
    shifts.set(id, { id, days, startDate: moved.startDate, endDate: moved.endDate });
  }
  return [...shifts.values()];
}

export interface CriticalPath {
  projectEnd: string | null;
  // Start to finish.
  chain: number[];
}

export function criticalPath(rows: DepRow[], deps: Dep[]): CriticalPath {
  const dated = rows.filter((r) => r.endDate);
  if (!dated.length) return { projectEnd: null, chain: [] };
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Ties on the last end date: the one first in the plan.
  const last = [...dated].sort((a, b) => (a.endDate! < b.endDate! ? 1 : a.endDate! > b.endDate! ? -1 : (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id))[0];
  const preds = new Map<number, Dep[]>();
  for (const d of deps) {
    if (!preds.has(d.successorRowId)) preds.set(d.successorRowId, []);
    preds.get(d.successorRowId)!.push(d);
  }
  const chain = [last.id];
  const seen = new Set(chain);
  let current = last;
  for (;;) {
    if (!current.startDate) break;
    let driver: DepRow | null = null;
    let driverEarliest = '';
    for (const d of preds.get(current.id) || []) {
      const p = byId.get(d.predecessorRowId);
      if (!p?.endDate || seen.has(p.id)) continue;
      const e = earliestStart(p.endDate, d.lagDays);
      // No slack: the predecessor's finish (+ gap) reaches this start.
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
