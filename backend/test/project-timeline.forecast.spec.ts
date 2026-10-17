import { forecastPlan } from '../src/project-timeline/project-timeline-forecast';

// Project Timeline Stage D (2026-10-16): forecast rules.
describe('Project Timeline forecast', () => {
  const TODAY = '2026-10-16';
  const row = (id: number, status: string, startDate: string | null, endDate: string | null, sortOrder = id) => ({ id, status, startDate, endDate, sortOrder });
  const dep = (predecessorRowId: number, successorRowId: number, lagDays = 0) => ({ predecessorRowId, successorRowId, lagDays });
  const byId = (f: ReturnType<typeof forecastPlan>, id: number) => f.rows.find((r) => r.id === id)!;
  const codes = (f: ReturnType<typeof forecastPlan>, id: number) => byId(f, id).reasons.map((r) => r.code);

  it('on-plan phases forecast their plan dates; completed ones never move, even if overdue', () => {
    const f = forecastPlan([row(1, 'Completed', '2026-09-01', '2026-09-30'), row(2, 'To Do', '2026-11-01', '2026-11-10'), row(3, 'In Progress', '2026-10-01', '2026-10-31')], [], TODAY);
    expect(f.rows.map((r) => [r.id, r.end, r.slipDays, r.reasons.length])).toEqual([
      [1, '2026-09-30', 0, 0],
      [2, '2026-11-10', 0, 0],
      [3, '2026-10-31', 0, 0],
    ]);
    expect(byId(f, 1).done).toBe(true);
    expect(f).toMatchObject({ plannedEnd: '2026-11-10', likelyEnd: '2026-11-10', slipDays: 0, drivers: [2] });
  });

  it('a To Do or On Hold phase whose start has passed starts today, keeping its length', () => {
    const f = forecastPlan([row(1, 'To Do', '2026-10-10', '2026-10-19'), row(2, 'On Hold', '2026-10-01', '2026-10-05')], [], TODAY);
    expect(byId(f, 1)).toMatchObject({ start: TODAY, end: '2026-10-25', slipDays: 6, reasons: [{ code: 'late_start' }] });
    expect(byId(f, 2)).toMatchObject({ start: TODAY, end: '2026-10-20', slipDays: 15 });
  });

  it('a started phase past its end date finishes today at the earliest', () => {
    const f = forecastPlan([row(1, 'Delayed', '2026-10-01', '2026-10-10')], [], TODAY);
    expect(byId(f, 1)).toMatchObject({ end: TODAY, slipDays: 6, reasons: [{ code: 'overdue' }] });
  });

  it('ticket pace scales the elapsed days to 100%, but never forecasts earlier than planned', () => {
    // Started 1 Oct: 16 days elapsed at 40% -> 40 days -> ends 9 Nov.
    const slow = forecastPlan([row(1, 'In Progress', '2026-10-01', '2026-10-31')], [], TODAY, new Map([[1, { percent: 40, counted: 5 }]]));
    expect(byId(slow, 1)).toMatchObject({ end: '2026-11-09', slipDays: 9, reasons: [{ code: 'ticket_pace', percent: 40, elapsedDays: 16 }] });
    const fast = forecastPlan([row(1, 'In Progress', '2026-10-01', '2026-10-31')], [], TODAY, new Map([[1, { percent: 90, counted: 5 }]]));
    expect(byId(fast, 1)).toMatchObject({ end: '2026-10-31', slipDays: 0, reasons: [] });
  });

  it('no pace from 0%, 100%, no counted tickets, or a phase that is not started', () => {
    const r = [row(1, 'In Progress', '2026-10-01', '2026-10-20')];
    for (const p of [{ percent: 0, counted: 3 }, { percent: 100, counted: 3 }, { percent: null, counted: 0 }]) {
      expect(byId(forecastPlan(r, [], TODAY, new Map([[1, p]])), 1).end).toBe('2026-10-20');
    }
    expect(codes(forecastPlan([row(1, 'To Do', '2026-11-01', '2026-11-05')], [], TODAY, new Map([[1, { percent: 10, counted: 3 }]])), 1)).toEqual([]);
  });

  it('a phase not yet started is pushed after what it waits on (+ gap), down the chain, and drivers name the chain', () => {
    const f = forecastPlan(
      [row(1, 'Delayed', '2026-10-01', '2026-10-10'), row(2, 'To Do', '2026-10-17', '2026-10-20'), row(3, 'To Do', '2026-10-21', '2026-10-30'), row(4, 'To Do', '2026-10-01', '2026-10-02')],
      [dep(1, 2, 2), dep(2, 3)],
      TODAY,
    );
    // 1 ends today -> 2 may start 19 Oct (gap 2) -> ends 22 Oct -> 3 starts 23 Oct, ends 1 Nov.
    expect(byId(f, 2)).toMatchObject({ start: '2026-10-19', end: '2026-10-22', reasons: [{ code: 'waits_on', rowId: 1 }] });
    expect(byId(f, 3)).toMatchObject({ start: '2026-10-23', end: '2026-11-01', slipDays: 2, reasons: [{ code: 'waits_on', rowId: 2 }] });
    expect(f).toMatchObject({ plannedEnd: '2026-10-30', likelyEnd: '2026-11-01', slipDays: 2, drivers: [1, 2, 3] });
  });

  it('a phase already under way, or completed, is not pushed by its predecessors', () => {
    const f = forecastPlan([row(1, 'Delayed', '2026-10-01', '2026-10-10'), row(2, 'In Progress', '2026-10-12', '2026-10-25'), row(3, 'Completed', '2026-10-11', '2026-10-12')], [dep(1, 2), dep(1, 3)], TODAY);
    expect(byId(f, 2).end).toBe('2026-10-25');
    expect(byId(f, 3).end).toBe('2026-10-12');
  });

  it('a successor that already starts late enough is left alone; late start and waits_on can both apply', () => {
    const f = forecastPlan([row(1, 'In Progress', '2026-10-01', '2026-10-20'), row(2, 'To Do', '2026-10-25', '2026-10-30'), row(3, 'To Do', '2026-10-10', '2026-10-12')], [dep(1, 2), dep(1, 3)], TODAY);
    expect(byId(f, 2).reasons).toEqual([]);
    // 3 would start today (late), but 1 ends 20 Oct -> starts 21 Oct, 3 days long.
    expect(byId(f, 3)).toMatchObject({ start: '2026-10-21', end: '2026-10-23' });
    expect(codes(f, 3)).toEqual(['late_start', 'waits_on']);
  });

  it('phases with no end date get no forecast; an empty plan has none at all', () => {
    const f = forecastPlan([row(1, 'To Do', '2026-10-01', null), row(2, 'To Do', null, '2026-11-01')], [], TODAY);
    expect(f.rows.map((r) => r.id)).toEqual([2]);
    expect(forecastPlan([], [], TODAY)).toMatchObject({ plannedEnd: null, likelyEnd: null, slipDays: null, drivers: [] });
  });
});
