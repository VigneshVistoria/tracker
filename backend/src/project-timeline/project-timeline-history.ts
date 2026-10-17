// Project Timeline - time travel (2026-10-17): every saved change to this
// project's phases, from the audit log (nothing new is stored), so the page
// can rebuild the plan as it stood at the end of any past day. Pure (no
// Nest/TypeORM) so it can be tested directly.
//
// The page rewinds from today's saved rows: newest event first, an update
// puts each field back to its old value, a create removes the row and a
// delete brings back its snapshot.

import { dateInZone } from '../team-settings/time-zone';
import { CHANGE_ACTIONS, ChangeEvent } from './project-timeline-changes';

export const HISTORY_FIELDS = ['module', 'phase', 'team', 'status', 'startDate', 'endDate', 'order'] as const;
type HistoryField = (typeof HISTORY_FIELDS)[number];
type Values = Partial<Record<HistoryField, string | number | null>>;

export interface HistoryEvent {
  id: number;
  at: string;
  // Day of the change in the team time zone (YYYY-MM-DD).
  day: string;
  by: string | null;
  rowId: number;
  kind: 'created' | 'updated' | 'deleted';
  // created: the new row; deleted: the row as it was; updated: field -> old/new.
  values?: Values;
  changes?: Partial<Record<HistoryField, { old: unknown; new: unknown }>>;
}

const KIND: Record<string, HistoryEvent['kind']> = {
  [CHANGE_ACTIONS.rowCreated]: 'created',
  [CHANGE_ACTIONS.rowUpdated]: 'updated',
  [CHANGE_ACTIONS.rowDeleted]: 'deleted',
};

const pick = (v: Record<string, any> | null | undefined): Values =>
  Object.fromEntries(HISTORY_FIELDS.filter((f) => v && f in v).map((f) => [f, v![f] ?? null])) as Values;

// Oldest first. Events for other projects, other entity types and rows
// without an id are left out.
export function historyEvents(logs: ChangeEvent[], projectId: number, timeZone: string): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  for (const l of [...logs].sort((a, b) => a.id - b.id)) {
    const kind = KIND[l.action];
    if (!kind || l.entityType !== 'ProjectTimelineRow' || l.entityId == null) continue;
    if (Number(l.details?.projectId) !== projectId) continue;
    const at = l.at instanceof Date ? l.at : new Date(l.at);
    const e: HistoryEvent = { id: l.id, at: at.toISOString(), day: dateInZone(at, timeZone), by: l.by, rowId: l.entityId, kind };
    if (kind === 'created') e.values = pick(l.details?.values);
    if (kind === 'deleted') e.values = pick(l.details?.snapshot);
    if (kind === 'updated') {
      const changes = Object.fromEntries(Object.entries(l.details?.changes || {}).filter(([f]) => (HISTORY_FIELDS as readonly string[]).includes(f)));
      if (!Object.keys(changes).length) continue;
      e.changes = changes as HistoryEvent['changes'];
    }
    out.push(e);
  }
  return out;
}
