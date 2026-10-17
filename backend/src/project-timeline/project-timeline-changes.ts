// Project Timeline Stage D (2026-10-16): "What changed" over a period,
// read from the audit log (nothing new is stored). Pure (no Nest/TypeORM)
// so it can be tested directly, and so the weekly Teams digest can reuse
// it.
//
// - Per phase, the net change over the period: each field's value before
//   the first change and after the last (a date moved and moved back is
//   no change). Order-only edits are left out.
// - Plus the plan-level events: imports, baseline resets, dependency and
//   ticket-link changes.

import { daysFromTo } from './project-timeline-dependencies';

export interface ChangeEvent {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  at: Date | string;
  by: string | null;
  details: Record<string, any> | null;
}

export const CHANGE_ACTIONS = {
  rowCreated: 'project_timeline_row_created',
  rowUpdated: 'project_timeline_row_updated',
  rowDeleted: 'project_timeline_row_deleted',
  imported: 'project_timeline_imported',
  baselineReset: 'project_timeline_baseline_reset',
  depAdded: 'project_timeline_dependency_added',
  depUpdated: 'project_timeline_dependency_updated',
  depRemoved: 'project_timeline_dependency_removed',
  linkAdded: 'project_timeline_ticket_link_added',
  linkRemoved: 'project_timeline_ticket_link_removed',
} as const;

export const CHANGE_ENTITY_TYPES = ['ProjectTimelineRow', 'Project', 'ProjectTimelineDependency', 'ProjectTimelineTicketLink'];

const NET_FIELDS = ['module', 'phase', 'team', 'status', 'startDate', 'endDate'] as const;
type NetField = (typeof NET_FIELDS)[number];

export interface PhaseChange {
  rowId: number;
  module: string;
  phase: string;
  kind: 'added' | 'removed' | 'changed';
  changes: Partial<Record<NetField, { old: unknown; new: unknown }>>;
  // End date moved: + later, - earlier (calendar days).
  endShiftDays: number | null;
  by: string[];
  lastAt: string;
}

export interface PlanEvent {
  id: number;
  at: string;
  by: string | null;
  kind: 'import' | 'baseline_reset' | 'dependency_added' | 'dependency_updated' | 'dependency_removed' | 'link_added' | 'link_removed';
  text: string;
}

export interface ChangeSummary {
  phases: PhaseChange[];
  events: PlanEvent[];
  totals: {
    added: number;
    removed: number;
    endLater: number;
    endEarlier: number;
    statusChanged: number;
    completed: number;
    otherChanged: number;
    planEvents: number;
  };
  people: { email: string; changes: number }[];
}

const iso = (at: Date | string) => (at instanceof Date ? at.toISOString() : new Date(at).toISOString());
const phaseName = (x: any) => (x ? `${x.phase ?? '?'}${x.module ? ` (${x.module})` : ''}` : '?');

// Only this project's entries: Project entries by id, the rest by details.projectId.
export function belongsToProject(e: ChangeEvent, projectId: number): boolean {
  if (e.entityType === 'Project') return e.entityId === projectId;
  return Number(e.details?.projectId) === projectId;
}

export function summarizeChanges(all: ChangeEvent[], projectId: number): ChangeSummary {
  const events = all.filter((e) => belongsToProject(e, projectId)).sort((a, b) => iso(a.at).localeCompare(iso(b.at)) || a.id - b.id);
  const rows = new Map<number, { module: string; phase: string; created: boolean; deleted: boolean; first: Record<string, unknown>; last: Record<string, unknown>; by: Set<string>; lastAt: string }>();
  const planEvents: PlanEvent[] = [];
  const people = new Map<string, number>();
  const count = (by: string | null) => by && people.set(by, (people.get(by) || 0) + 1);

  for (const e of events) {
    const d = e.details || {};
    const at = iso(e.at);
    if (e.entityType === 'ProjectTimelineRow' && e.entityId != null) {
      const vals = d.values || d.snapshot || {};
      let r = rows.get(e.entityId);
      if (!r) {
        r = { module: d.module ?? vals.module ?? '', phase: d.phase ?? vals.phase ?? '', created: false, deleted: false, first: {}, last: {}, by: new Set(), lastAt: at };
        rows.set(e.entityId, r);
      }
      if (e.action === CHANGE_ACTIONS.rowCreated) {
        r.created = true;
        r.deleted = false;
        for (const f of NET_FIELDS) r.last[f] = vals[f] ?? null;
      } else if (e.action === CHANGE_ACTIONS.rowDeleted) {
        r.deleted = true;
      } else if (e.action === CHANGE_ACTIONS.rowUpdated) {
        const changes = d.changes || {};
        const fields = NET_FIELDS.filter((f) => changes[f]);
        if (!fields.length) continue; // order only
        for (const f of fields) {
          if (!(f in r.first) && !r.created) r.first[f] = changes[f].old ?? null;
          r.last[f] = changes[f].new ?? null;
        }
      } else continue;
      r.module = (r.last.module as string) ?? d.module ?? vals.module ?? r.module;
      r.phase = (r.last.phase as string) ?? d.phase ?? vals.phase ?? r.phase;
      if (e.by) r.by.add(e.by);
      r.lastAt = at;
      count(e.by);
      continue;
    }
    const plan = planEvent(e, d, at);
    if (plan) {
      planEvents.push(plan);
      count(e.by);
    }
  }

  const phases: PhaseChange[] = [];
  for (const [rowId, r] of rows) {
    if (r.created && r.deleted) continue; // added and removed within the period
    const base = { rowId, module: r.module, phase: r.phase, by: [...r.by], lastAt: r.lastAt };
    if (r.deleted) {
      phases.push({ ...base, kind: 'removed', changes: {}, endShiftDays: null });
      continue;
    }
    if (r.created) {
      phases.push({ ...base, kind: 'added', changes: {}, endShiftDays: null });
      continue;
    }
    const changes: PhaseChange['changes'] = {};
    for (const f of NET_FIELDS) if (f in r.first && r.first[f] !== r.last[f]) changes[f] = { old: r.first[f], new: r.last[f] };
    if (!Object.keys(changes).length) continue; // changed and changed back
    const e = changes.endDate;
    const endShiftDays = e && e.old && e.new ? daysFromTo(e.old as string, e.new as string) : null;
    phases.push({ ...base, kind: 'changed', changes, endShiftDays });
  }
  // Biggest end-date moves first, then most recent.
  phases.sort((a, b) => Math.abs(b.endShiftDays ?? 0) - Math.abs(a.endShiftDays ?? 0) || b.lastAt.localeCompare(a.lastAt));

  const changed = phases.filter((p) => p.kind === 'changed');
  return {
    phases,
    events: planEvents.reverse(),
    totals: {
      added: phases.filter((p) => p.kind === 'added').length,
      removed: phases.filter((p) => p.kind === 'removed').length,
      endLater: changed.filter((p) => (p.endShiftDays ?? 0) > 0).length,
      endEarlier: changed.filter((p) => (p.endShiftDays ?? 0) < 0).length,
      statusChanged: changed.filter((p) => p.changes.status).length,
      completed: changed.filter((p) => p.changes.status?.new === 'Completed').length,
      otherChanged: changed.filter((p) => !p.changes.status && !p.endShiftDays).length,
      planEvents: planEvents.length,
    },
    people: [...people].map(([email, changes]) => ({ email, changes })).sort((a, b) => b.changes - a.changes || a.email.localeCompare(b.email)),
  };
}

function planEvent(e: ChangeEvent, d: Record<string, any>, at: string): PlanEvent | null {
  const base = { id: e.id, at, by: e.by };
  const lag = (n: number) => (n ? ` (+${n} day${n === 1 ? '' : 's'} gap)` : '');
  const linkTarget = (x: any) =>
    x.ticket ? `ticket #${x.ticket.id}` : x.module ? `module ${x.module.name}${x.phase ? ` / ${x.phase.name}` : ''}` : x.taskId ? `ticket #${x.taskId}` : 'a module';
  switch (e.action) {
    case CHANGE_ACTIONS.imported:
      return { ...base, kind: 'import', text: `Imported a file: ${d.created ?? 0} added, ${d.updated ?? 0} updated, ${d.deleted ?? 0} removed` };
    case CHANGE_ACTIONS.baselineReset:
      return { ...base, kind: 'baseline_reset', text: `Baseline reset${d.reason ? `: “${d.reason}”` : ''}` };
    case CHANGE_ACTIONS.depAdded:
      return { ...base, kind: 'dependency_added', text: `${phaseName(d.successor)} now starts after ${phaseName(d.predecessor)}${lag(d.lagDays)}` };
    case CHANGE_ACTIONS.depUpdated:
      return { ...base, kind: 'dependency_updated', text: `Gap between ${phaseName(d.predecessor)} and ${phaseName(d.successor)}: ${d.lagDays?.old ?? 0} to ${d.lagDays?.new ?? 0} days` };
    case CHANGE_ACTIONS.depRemoved:
      return { ...base, kind: 'dependency_removed', text: `${phaseName(d.successor)} no longer waits for ${phaseName(d.predecessor)}` };
    case CHANGE_ACTIONS.linkAdded:
      return { ...base, kind: 'link_added', text: `${phaseName(d.row)} linked to ${linkTarget(d)}` };
    case CHANGE_ACTIONS.linkRemoved:
      return { ...base, kind: 'link_removed', text: `${phaseName(d.row)} unlinked from ${linkTarget(d)}` };
    default:
      return null;
  }
}
