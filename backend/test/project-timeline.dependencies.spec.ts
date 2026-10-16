import {
  cascadeShifts,
  criticalPath,
  daysFromTo,
  dependencyConflicts,
  earliestStart,
  wouldCreateCycle,
} from '../src/project-timeline/project-timeline-dependencies';

// Project Timeline Stage B (2026-10-16): dependency rules.
describe('Project Timeline dependency rules', () => {
  const row = (id: number, startDate: string | null, endDate: string | null, sortOrder = id) => ({ id, startDate, endDate, sortOrder });
  const dep = (predecessorRowId: number, successorRowId: number, lagDays = 0) => ({ predecessorRowId, successorRowId, lagDays });

  it('a successor may start the day after its predecessor ends, plus the gap', () => {
    expect(earliestStart('2026-10-10', 0)).toBe('2026-10-11');
    expect(earliestStart('2026-10-10', 2)).toBe('2026-10-13');
    expect(earliestStart('2026-12-31', 0)).toBe('2027-01-01');
    expect(daysFromTo('2026-10-11', '2026-10-13')).toBe(2);
  });

  describe('loops', () => {
    const deps = [dep(1, 2), dep(2, 3)];
    it('refuses a self-link and any link that closes a loop, directly or through others', () => {
      expect(wouldCreateCycle(deps, 4, 4)).toBe(true);
      expect(wouldCreateCycle(deps, 2, 1)).toBe(true);
      expect(wouldCreateCycle(deps, 3, 1)).toBe(true);
    });
    it('allows links that keep it a one-way chain, including a second path to the same phase', () => {
      expect(wouldCreateCycle(deps, 1, 3)).toBe(false);
      expect(wouldCreateCycle(deps, 3, 4)).toBe(false);
      expect(wouldCreateCycle([], 1, 2)).toBe(false);
    });
  });

  describe('conflicts', () => {
    it('flags a successor that starts too early, by how many days', () => {
      const rows = [row(1, '2026-10-01', '2026-10-10'), row(2, '2026-10-09', '2026-10-20'), row(3, '2026-10-11', '2026-10-15')];
      const c = dependencyConflicts(rows, [dep(1, 2), dep(1, 3)]);
      expect(c.map((x) => [x.successor.id, x.earliest, x.daysEarly])).toEqual([[2, '2026-10-11', 2]]);
    });
    it('counts the gap; touching the earliest day is fine', () => {
      const rows = [row(1, '2026-10-01', '2026-10-10'), row(2, '2026-10-12', '2026-10-20')];
      expect(dependencyConflicts(rows, [dep(1, 2, 1)])).toHaveLength(0);
      expect(dependencyConflicts(rows, [dep(1, 2, 2)]).map((x) => x.daysEarly)).toEqual([1]);
    });
    it('never flags a link with a missing date', () => {
      // 1 has no end (can't be a predecessor), 2 has no start (can't be a successor).
      const rows = [row(1, '2026-10-01', null), row(2, null, '2026-10-02'), row(3, '2026-09-01', '2026-12-01')];
      expect(dependencyConflicts(rows, [dep(1, 3), dep(3, 2)])).toHaveLength(0);
    });
  });

  describe('shift them too', () => {
    it('moves each early phase later by just enough, keeps its length, and carries on down the chain', () => {
      const rows = [row(1, '2026-10-01', '2026-10-15'), row(2, '2026-10-10', '2026-10-20'), row(3, '2026-10-21', '2026-10-25'), row(4, '2026-11-30', '2026-12-05')];
      const shifts = cascadeShifts(rows, [dep(1, 2), dep(2, 3), dep(3, 4)]);
      expect(shifts).toEqual([
        { id: 2, days: 6, startDate: '2026-10-16', endDate: '2026-10-26' },
        { id: 3, days: 6, startDate: '2026-10-27', endDate: '2026-10-31' },
      ]);
    });
    it('uses the latest of several predecessors, with gaps; never moves anything earlier', () => {
      const rows = [row(1, '2026-10-01', '2026-10-05'), row(2, '2026-10-01', '2026-10-08'), row(3, '2026-10-07', '2026-10-09'), row(5, '2026-12-01', '2026-12-02')];
      const shifts = cascadeShifts(rows, [dep(1, 3, 3), dep(2, 3, 1), dep(1, 5)]);
      expect(shifts).toEqual([{ id: 3, days: 3, startDate: '2026-10-10', endDate: '2026-10-12' }]);
    });
    it('a phase with no end keeps no end; one with no start is left alone', () => {
      const rows = [row(1, '2026-10-01', '2026-10-10'), row(2, '2026-10-05', null), row(3, null, '2026-10-06')];
      expect(cascadeShifts(rows, [dep(1, 2), dep(1, 3)])).toEqual([{ id: 2, days: 6, startDate: '2026-10-11', endDate: null }]);
    });
  });

  describe('critical path', () => {
    it('walks back from the last phase through predecessors that leave no slack', () => {
      const rows = [
        row(1, '2026-10-01', '2026-10-10'),
        row(2, '2026-10-11', '2026-10-20'), // right after 1: critical
        row(3, '2026-10-01', '2026-10-05'), // finishes early: slack before 4
        row(4, '2026-10-21', '2026-11-10'), // the end
      ];
      expect(criticalPath(rows, [dep(1, 2), dep(2, 4), dep(3, 4)])).toEqual({ projectEnd: '2026-11-10', chain: [1, 2, 4] });
    });
    it('a gap counts as no slack when it reaches the start exactly', () => {
      const rows = [row(1, '2026-10-01', '2026-10-10'), row(2, '2026-10-13', '2026-10-20')];
      expect(criticalPath(rows, [dep(1, 2, 2)]).chain).toEqual([1, 2]);
      expect(criticalPath(rows, [dep(1, 2, 1)]).chain).toEqual([2]);
    });
    it('a predecessor that runs late (a conflict) is on the path too', () => {
      const rows = [row(1, '2026-10-01', '2026-10-15'), row(2, '2026-10-10', '2026-10-20')];
      expect(criticalPath(rows, [dep(1, 2)]).chain).toEqual([1, 2]);
    });
    it('with no links it is just the phase that ends last (first in the plan on a tie); no dates gives nothing', () => {
      expect(criticalPath([row(1, null, '2026-10-30', 2), row(2, null, '2026-10-30', 1), row(3, null, '2026-10-01')], [])).toEqual({ projectEnd: '2026-10-30', chain: [2] });
      expect(criticalPath([row(1, null, null)], [])).toEqual({ projectEnd: null, chain: [] });
    });
  });
});
