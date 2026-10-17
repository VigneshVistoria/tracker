import { summarizeChanges } from '../src/project-timeline/project-timeline-changes';

// Project Timeline Stage D (2026-10-16): "What changed" from the audit log.
describe('Project Timeline what changed', () => {
  let n = 0;
  const ev = (action: string, entityType: string, entityId: number, details: Record<string, any>, by = 'pm@x.com', at = `2026-10-1${(n % 6) + 1}T10:00:00Z`) => ({
    id: ++n,
    action: `project_timeline_${action}`,
    entityType,
    entityId,
    at,
    by,
    details,
  });
  const upd = (id: number, changes: Record<string, any>, extra: Record<string, any> = {}) =>
    ev('row_updated', 'ProjectTimelineRow', id, { projectId: 7, module: 'Claims', phase: 'Build', changes, ...extra });

  beforeEach(() => (n = 0));

  it('nets each phase over the period: first old value to last new value; end moves in days', () => {
    const s = summarizeChanges(
      [
        upd(1, { endDate: { old: '2026-11-01', new: '2026-11-05' } }),
        upd(1, { endDate: { old: '2026-11-05', new: '2026-11-15' }, status: { old: 'To Do', new: 'In Progress' } }),
        upd(2, { endDate: { old: '2026-11-10', new: '2026-11-03' } }, { phase: 'UAT' }),
      ],
      7,
    );
    expect(s.phases.map((p) => [p.rowId, p.kind, p.endShiftDays, Object.keys(p.changes)])).toEqual([
      [1, 'changed', 14, ['status', 'endDate']],
      [2, 'changed', -7, ['endDate']],
    ]);
    expect(s.phases[0].changes.endDate).toEqual({ old: '2026-11-01', new: '2026-11-15' });
    expect(s.totals).toMatchObject({ endLater: 1, endEarlier: 1, statusChanged: 1, completed: 0 });
  });

  it('a change undone within the period, and order-only edits, are left out', () => {
    const s = summarizeChanges([upd(1, { status: { old: 'To Do', new: 'Delayed' } }), upd(1, { status: { old: 'Delayed', new: 'To Do' } }), upd(2, { order: { old: 1, new: 2 } })], 7);
    expect(s.phases).toEqual([]);
    expect(s.people).toEqual([{ email: 'pm@x.com', changes: 2 }]);
  });

  it('added and removed phases; added-then-removed within the period is nothing', () => {
    const vals = (phase: string) => ({ module: 'Claims', phase, team: null, status: 'To Do', startDate: null, endDate: '2026-12-01', order: 1 });
    const s = summarizeChanges(
      [
        ev('row_created', 'ProjectTimelineRow', 1, { projectId: 7, values: vals('New') }),
        upd(1, { endDate: { old: '2026-12-01', new: '2026-12-09' } }, { phase: 'New' }),
        ev('row_deleted', 'ProjectTimelineRow', 2, { projectId: 7, snapshot: vals('Old') }),
        ev('row_created', 'ProjectTimelineRow', 3, { projectId: 7, values: vals('Brief') }),
        ev('row_deleted', 'ProjectTimelineRow', 3, { projectId: 7, snapshot: vals('Brief') }),
      ],
      7,
    );
    expect(s.phases.map((p) => [p.rowId, p.kind, p.phase])).toEqual(
      expect.arrayContaining([
        [1, 'added', 'New'],
        [2, 'removed', 'Old'],
      ]),
    );
    expect(s.phases).toHaveLength(2);
    expect(s.totals).toMatchObject({ added: 1, removed: 1 });
  });

  it("other projects' entries are left out (Project entries by id, the rest by details.projectId)", () => {
    const s = summarizeChanges(
      [
        upd(1, { status: { old: 'To Do', new: 'Completed' } }, { projectId: 8 }),
        ev('baseline_reset', 'Project', 8, { reason: 'other' }),
        ev('baseline_reset', 'Project', 7, { reason: 'Scope change' }),
      ],
      7,
    );
    expect(s.phases).toEqual([]);
    expect(s.events.map((e) => e.text)).toEqual(['Baseline reset: “Scope change”']);
  });

  it('plan events read as plain sentences, newest first', () => {
    const p = (id: number, phase: string) => ({ id, module: 'Claims', phase });
    const s = summarizeChanges(
      [
        ev('imported', 'Project', 7, { created: 3, updated: 2, deleted: 1 }, 'a@x.com', '2026-10-10T09:00:00Z'),
        ev('dependency_added', 'ProjectTimelineDependency', 1, { projectId: 7, predecessor: p(1, 'Build'), successor: p(2, 'UAT'), lagDays: 2 }, 'a@x.com', '2026-10-11T09:00:00Z'),
        ev('dependency_updated', 'ProjectTimelineDependency', 1, { projectId: 7, predecessor: p(1, 'Build'), successor: p(2, 'UAT'), lagDays: { old: 2, new: 5 } }, 'a@x.com', '2026-10-12T09:00:00Z'),
        ev('dependency_removed', 'ProjectTimelineDependency', 1, { projectId: 7, predecessor: p(1, 'Build'), successor: p(2, 'UAT'), lagDays: 5 }, 'a@x.com', '2026-10-13T09:00:00Z'),
        ev('ticket_link_added', 'ProjectTimelineTicketLink', 1, { projectId: 7, row: p(1, 'Build'), module: { id: 1, name: 'Pre-Auth' }, phase: { id: 2, name: 'Dev' } }, 'b@x.com', '2026-10-14T09:00:00Z'),
        ev('ticket_link_removed', 'ProjectTimelineTicketLink', 2, { projectId: 7, row: p(1, 'Build'), taskId: 42 }, 'b@x.com', '2026-10-15T09:00:00Z'),
      ],
      7,
    );
    expect(s.events.map((e) => e.text)).toEqual([
      'Build (Claims) unlinked from ticket #42',
      'Build (Claims) linked to module Pre-Auth / Dev',
      'UAT (Claims) no longer waits for Build (Claims)',
      'Gap between Build (Claims) and UAT (Claims): 2 to 5 days',
      'UAT (Claims) now starts after Build (Claims) (+2 days gap)',
      'Imported a file: 3 added, 2 updated, 1 removed',
    ]);
    expect(s.people).toEqual([
      { email: 'a@x.com', changes: 4 },
      { email: 'b@x.com', changes: 2 },
    ]);
  });
});
