import { historyEvents } from '../src/project-timeline/project-timeline-history';

const ev = (id: number, action: string, details: any, o: any = {}) => ({
  id,
  action: `project_timeline_row_${action}`,
  entityType: 'ProjectTimelineRow',
  entityId: 10,
  at: '2026-10-10T22:30:00Z',
  by: 'pm@x',
  details: { projectId: 2, ...details },
  ...o,
});

describe('historyEvents', () => {
  it('keeps this project row events, oldest first, with the team-zone day', () => {
    const out = historyEvents(
      [
        ev(3, 'deleted', { snapshot: { module: 'M', phase: 'P', team: 'A', status: 'To Do', startDate: null, endDate: '2026-11-01', order: 2, extra: 1 } }),
        ev(1, 'created', { values: { module: 'M', phase: 'P', team: null, status: 'To Do', startDate: '2026-10-01', endDate: '2026-10-20', order: 2 } }),
        ev(2, 'updated', { changes: { endDate: { old: '2026-10-20', new: '2026-11-01' }, team: { old: null, new: 'A' } } }),
      ],
      2,
      'Africa/Addis_Ababa',
    );
    expect(out.map((e) => [e.id, e.kind])).toEqual([
      [1, 'created'],
      [2, 'updated'],
      [3, 'deleted'],
    ]);
    // 22:30 UTC is the next day in UTC+3.
    expect(out[0].day).toBe('2026-10-11');
    expect(out[0].values).toEqual({ module: 'M', phase: 'P', team: null, status: 'To Do', startDate: '2026-10-01', endDate: '2026-10-20', order: 2 });
    expect(out[1].changes).toEqual({ endDate: { old: '2026-10-20', new: '2026-11-01' }, team: { old: null, new: 'A' } });
    expect(out[2].values).toEqual({ module: 'M', phase: 'P', team: 'A', status: 'To Do', startDate: null, endDate: '2026-11-01', order: 2 });
  });

  it('leaves out other projects, other entities, other actions, empty updates', () => {
    const out = historyEvents(
      [
        ev(1, 'created', { projectId: 3, values: {} }),
        ev(2, 'created', { values: {} }, { entityType: 'Project' }),
        { ...ev(3, 'created', { values: {} }), action: 'project_timeline_imported' },
        ev(4, 'updated', { changes: { batchOnly: { old: 1, new: 2 } } }),
        ev(5, 'created', { values: { module: 'M' } }, { entityId: null }),
        ev(6, 'updated', { changes: { status: { old: 'To Do', new: 'Completed' } } }),
      ],
      2,
      'UTC',
    );
    expect(out.map((e) => e.id)).toEqual([6]);
  });
});
