// Project Timeline Stage C (2026-10-16): progress from tickets. Pure (no
// Nest/TypeORM) so it can be tested directly; the page keeps a copy of
// ticketMismatches() in frontend/lib/projectTimelineTickets.js (it runs on
// the phase's unsaved status) - keep the two in step.
//
// Rules confirmed with the user:
// - A phase's tickets = every ticket in each linked app Module (+ Phase,
//   when the link names one) of the same project, plus each ticket linked
//   on its own - each ticket once.
// - Progress % = the average "% Complete" of those tickets, using the
//   Admin's Task Status Config (Development 0, Feedback 50, Pass 100 ...),
//   so it matches the rest of the app. Junk and Closed tickets are left
//   out, as KPI does.
// - Done = a ticket at 100%. Open = every other counted ticket (Hold too).

import { TASK_STATUS_PERCENT_DEFAULTS } from '../task-status-config/task-status-percent.entity';

export const LEFT_OUT_STATUSES = ['Junk', 'Closed'];

export interface LinkInput {
  rowId: number;
  moduleId: number | null;
  phaseId: number | null;
  taskId: number | null;
}

export interface TicketInput {
  id: number;
  title: string;
  status: string;
  moduleId: number | null;
  phaseId: number | null;
}

export interface RowProgress {
  // Tickets counted in the % (Junk/Closed left out).
  counted: number;
  done: number;
  open: number;
  hold: number;
  // Moved past the first step (above 0%) or done.
  moving: number;
  leftOut: number;
  percent: number | null;
}

export function percentFor(status: string, percentByStatus: Record<string, number>): number {
  if (percentByStatus[status] != null) return percentByStatus[status];
  return (TASK_STATUS_PERCENT_DEFAULTS as Record<string, number>)[status] ?? 0;
}

// rowId -> its tickets (each once, in id order).
export function ticketsByRow(links: LinkInput[], tickets: TicketInput[]): Map<number, TicketInput[]> {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const sets = new Map<number, Set<number>>();
  for (const l of links) {
    if (!sets.has(l.rowId)) sets.set(l.rowId, new Set());
    const set = sets.get(l.rowId)!;
    if (l.taskId != null) {
      if (byId.has(l.taskId)) set.add(l.taskId);
      continue;
    }
    for (const t of tickets) {
      if (t.moduleId === l.moduleId && (l.phaseId == null || t.phaseId === l.phaseId)) set.add(t.id);
    }
  }
  const out = new Map<number, TicketInput[]>();
  for (const [rowId, ids] of sets) out.set(rowId, [...ids].sort((a, b) => a - b).map((id) => byId.get(id)!));
  return out;
}

export function rowProgress(tickets: TicketInput[], percentByStatus: Record<string, number>): RowProgress {
  const counted = tickets.filter((t) => !LEFT_OUT_STATUSES.includes(t.status));
  const pct = counted.map((t) => percentFor(t.status, percentByStatus));
  const done = pct.filter((p) => p >= 100).length;
  return {
    counted: counted.length,
    done,
    open: counted.length - done,
    hold: counted.filter((t) => t.status === 'Hold').length,
    moving: pct.filter((p) => p > 0).length,
    leftOut: tickets.length - counted.length,
    percent: counted.length ? Math.round(pct.reduce((a, b) => a + b, 0) / counted.length) : null,
  };
}

export type MismatchCode = 'completed_open' | 'todo_moving' | 'all_done' | 'no_match';

// Where the phase's status and its tickets disagree. linkCount = links on
// the phase (no links = nothing to compare, no flag).
export function ticketMismatches(rowStatus: string, progress: RowProgress | null, linkCount: number): { code: MismatchCode; text: string }[] {
  if (!linkCount || !progress) return [];
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if (progress.counted === 0) return [{ code: 'no_match', text: 'Linked, but no tickets match yet' }];
  const out: { code: MismatchCode; text: string }[] = [];
  if (rowStatus === 'Completed' && progress.open > 0) out.push({ code: 'completed_open', text: `Completed, but ${n(progress.open, 'ticket')} still open` });
  if (rowStatus === 'To Do' && progress.moving > 0) out.push({ code: 'todo_moving', text: `Still To Do, but ${n(progress.moving, 'ticket')} already in review or done` });
  if ((rowStatus === 'In Progress' || rowStatus === 'Delayed') && progress.open === 0) {
    out.push({ code: 'all_done', text: `All ${n(progress.counted, 'ticket')} done - mark Completed?` });
  }
  return out;
}
