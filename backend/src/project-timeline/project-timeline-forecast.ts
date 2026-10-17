// Project Timeline Stage D (2026-10-16): forecast. Pure (no Nest/TypeORM)
// so it can be tested directly; the page keeps a copy in
// frontend/lib/projectTimelineForecast.js (it runs on unsaved dates) -
// keep the two in step. Read-only: a forecast never changes the plan.
//
// "Likely finish" per phase, against its current plan dates:
// - Completed: as planned.
// - Not started (To Do), or paused (On Hold), and its start date has
//   passed: starts (again) today at the earliest, keeping its length.
// - Started (In Progress / Delayed): if linked
//   tickets show a pace (1-99% done), finish = start + elapsed days scaled
//   to 100%. Never forecast earlier than planned.
// - Not completed and its end date has passed: finishes today at the
//   earliest.
// - Dependencies: a phase that hasn't started can't start before what it
//   depends on is likely to finish (+ gap); the push flows down the chain,
//   keeping each phase's length. A phase already under way isn't pushed.
// - Phases without an end date get no forecast.

import { addDays } from './project-timeline-rules';
import { Dep, DepRow, daysFromTo, earliestStart, topoOrder } from './project-timeline-dependencies';

export interface ForecastRow extends DepRow {
  status: string;
}

export interface PaceInput {
  percent: number | null;
  counted: number;
}

export type ForecastReasonCode = 'late_start' | 'ticket_pace' | 'overdue' | 'waits_on';

export interface ForecastReason {
  code: ForecastReasonCode;
  // waits_on: the phase it waits for.
  rowId?: number;
  // ticket_pace: the % and days it's based on.
  percent?: number;
  elapsedDays?: number;
}

export interface RowForecast {
  id: number;
  plannedEnd: string;
  start: string | null;
  end: string;
  // Calendar days after the planned end (0 = on plan).
  slipDays: number;
  done: boolean;
  reasons: ForecastReason[];
}

export interface PlanForecast {
  today: string;
  plannedEnd: string | null;
  likelyEnd: string | null;
  slipDays: number | null;
  // Start to finish: the phases behind the likely finish (waits_on links
  // from the phase that ends last).
  drivers: number[];
  rows: RowForecast[];
}

const NOT_STARTED = ['To Do', 'On Hold'];
const STARTED = ['In Progress', 'Delayed'];
const later = (a: string, b: string) => (a > b ? a : b);

function ownForecast(r: ForecastRow, today: string, pace: PaceInput | null | undefined): Omit<RowForecast, 'slipDays'> {
  const plannedEnd = r.endDate!;
  const plannedStart = r.startDate ?? plannedEnd;
  const length = daysFromTo(plannedStart, plannedEnd);
  if (r.status === 'Completed') return { id: r.id, plannedEnd, start: r.startDate, end: plannedEnd, done: true, reasons: [] };

  const reasons: ForecastReason[] = [];
  let start = plannedStart;
  let end = plannedEnd;
  const started = STARTED.includes(r.status);
  if (NOT_STARTED.includes(r.status) && plannedStart < today) {
    start = today;
    end = addDays(today, length);
    reasons.push({ code: 'late_start' });
  }
  if (started && pace && pace.counted > 0 && pace.percent != null && pace.percent > 0 && pace.percent < 100 && plannedStart <= today) {
    const elapsedDays = daysFromTo(plannedStart, today) + 1;
    const paceEnd = addDays(plannedStart, Math.ceil((elapsedDays * 100) / pace.percent) - 1);
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

export function forecastPlan(rows: ForecastRow[], deps: Dep[], today: string, paceByRow: Map<number, PaceInput | null> = new Map()): PlanForecast {
  const dated = rows.filter((r) => r.endDate);
  const byId = new Map<number, Omit<RowForecast, 'slipDays'>>(dated.map((r) => [r.id, ownForecast(r, today, paceByRow.get(r.id))]));
  const rowById = new Map(dated.map((r) => [r.id, r]));
  const preds = new Map<number, Dep[]>();
  for (const d of deps) {
    if (!preds.has(d.successorRowId)) preds.set(d.successorRowId, []);
    preds.get(d.successorRowId)!.push(d);
  }
  for (const id of topoOrder([...byId.keys()], deps)) {
    const f = byId.get(id)!;
    const status = rowById.get(id)!.status;
    if (f.done || !NOT_STARTED.includes(status)) continue;
    const start = f.start ?? f.end;
    let required: string | null = null;
    let waitsOn: number | null = null;
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
    f.end = addDays(f.end, days);
    f.reasons = [...f.reasons.filter((x) => x.code !== 'overdue'), { code: 'waits_on', rowId: waitsOn! }];
  }

  const out: RowForecast[] = dated.map((r) => {
    const f = byId.get(r.id)!;
    return { ...f, slipDays: daysFromTo(f.plannedEnd, f.end) };
  });
  if (!out.length) return { today, plannedEnd: null, likelyEnd: null, slipDays: null, drivers: [], rows: out };
  const plannedEnd = out.reduce((m, f) => later(m, f.plannedEnd), out[0].plannedEnd);
  const likelyEnd = out.reduce((m, f) => later(m, f.end), out[0].end);
  // The phase that ends last (ties: first in the plan), then what it waits on.
  const order = new Map(rows.map((r, i) => [r.id, r.sortOrder ?? i]));
  const last = out.filter((f) => f.end === likelyEnd).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || a.id - b.id)[0];
  const drivers = [last.id];
  for (let cur = last; ; ) {
    const w = cur.reasons.find((x) => x.code === 'waits_on');
    if (!w || drivers.includes(w.rowId!)) break;
    drivers.unshift(w.rowId!);
    cur = out.find((f) => f.id === w.rowId)!;
  }
  return { today, plannedEnd, likelyEnd, slipDays: daysFromTo(plannedEnd, likelyEnd), drivers, rows: out };
}
