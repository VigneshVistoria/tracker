import { computeTrackingMetrics, TrackingMetricsInput, workingDaysBetweenDays, median } from '../src/performance-tracking/metrics/tracking-metrics';
import { PERFORMANCE_TRACKING_DEFAULTS } from '../src/performance-tracking/performance-tracking';

// Performance Tracking B2 (2026-10-30): the Wave 1 metrics on a small
// hand-worked scenario. Team zone Africa/Addis_Ababa (UTC+3), weekend
// Sat/Sun. Project switched on Mon 2 Nov 2026; snapshot Fri 20 Nov.
// Person 10 delivers tasks 1-4; person 20 holds task 5.
const at = (iso: string) => new Date(iso);
const cal = { timeZone: 'Africa/Addis_Ababa', weekendDays: [0, 6], holidays: new Set<string>() };
const task = (id: number, extra: any = {}) => ({
  id,
  status: 'Development',
  assigneeUserId: 10,
  createdByUserId: 99,
  dueDate: null,
  isDefect: false,
  taskType: null,
  requirementId: null,
  clientImpact: null,
  improvementDecision: null,
  improvementDecidedAt: null,
  ...extra,
});
const round = (taskId: number, status: string, submittedAt: string, reviewedAt: string, extra: any = {}) => ({
  taskId,
  submittedByUserId: 10,
  submittedAt: at(submittedAt),
  status,
  reviewType: 'qa',
  reviewedAt: at(reviewedAt),
  dependencyExempt: null,
  ...extra,
});
const flag = (extra: any) => ({
  setByAssignee: true,
  assigneeUserId: 10,
  committedDueDateAtSet: null,
  blockingOwnerUserId: null,
  external: false,
  dependencyTicketId: null,
  clearedAt: null,
  ...extra,
});

function input(overrides: Partial<TrackingMetricsInput> = {}): TrackingMetricsInput {
  return {
    snapshotDate: '2026-11-20',
    now: at('2026-11-20T23:30:00Z'),
    trackingSince: at('2026-11-02T06:00:00Z'),
    windowDays: 28,
    minSample: 5,
    calendar: cal,
    thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS },
    people: [10, 20],
    tasks: [
      task(1, { status: 'Pass', dueDate: '2026-11-10' }),
      task(2, { status: 'Pass', dueDate: '2026-11-12' }),
      task(3, { createdByUserId: 10, taskType: 'improvement', improvementDecision: 'accepted', improvementDecidedAt: at('2026-11-10T08:00:00Z') }),
      task(4, { status: 'Feedback', dueDate: '2026-11-19', taskType: 'feature', requirementId: 'REQ-1', clientImpact: 'Claims staff can refund in one step' }),
      task(5, { assigneeUserId: 20 }),
      // Junk is ignored everywhere.
      task(6, { status: 'Junk', dueDate: '2026-11-10' }),
    ],
    rounds: [
      round(1, 'approved', '2026-11-09T08:00:00Z', '2026-11-11T08:00:00Z'),
      round(2, 'not_ready', '2026-11-11T08:00:00Z', '2026-11-12T08:00:00Z', { dependencyExempt: true }),
      round(2, 'rejected', '2026-11-12T09:00:00Z', '2026-11-13T08:00:00Z'),
      round(2, 'approved', '2026-11-16T08:00:00Z', '2026-11-17T08:00:00Z'),
      { ...round(4, 'pending', '2026-11-18T08:00:00Z', '2026-11-18T08:00:00Z'), reviewedAt: null },
      round(6, 'approved', '2026-11-09T08:00:00Z', '2026-11-11T08:00:00Z'),
    ],
    commitmentEvents: [{ taskId: 5, kind: 'assigned', assigneeUserId: 20, occurredAt: at('2026-11-02T07:00:00Z'), newDueDate: null }],
    flags: [
      flag({ taskId: 2, kind: 'risk', committedDueDateAtSet: '2026-11-12', setAt: at('2026-11-06T08:00:00Z') }),
      flag({ taskId: 5, kind: 'blocker', assigneeUserId: 20, blockingOwnerUserId: 10, dependencyTicketId: 1, setAt: at('2026-11-09T08:00:00Z'), clearedAt: at('2026-11-10T10:00:00Z') }),
    ],
    tickets: [
      { id: 1, parentTaskId: 5, ownerUserId: 10, createdByUserId: 20, createdAt: at('2026-11-03T08:00:00Z'), overdueAt: at('2026-11-05T21:00:00Z'), status: 'resolved', resolvedAt: at('2026-11-10T09:00:00Z') },
    ],
    reopens: [{ taskId: 1, reopenedAt: at('2026-11-18T08:00:00Z'), passedAt: at('2026-11-11T08:00:00Z'), chargedUserId: 10 }],
    chases: [
      { taskId: 2, assigneeUserId: 10, createdAt: at('2026-11-10T08:00:00Z') },
      { taskId: 2, assigneeUserId: 10, createdAt: at('2026-11-11T08:00:00Z') },
    ],
    notes: [{ taskId: 5, authorUserId: 20, createdAt: at('2026-11-12T08:00:00Z') }],
    statusEvents: [{ taskId: 5, toStatus: 'Development', occurredAt: at('2026-11-02T07:00:00Z'), actorUserId: 99 }],
    onTimeItems: new Map([
      [
        10,
        [
          { taskId: 1, title: '', assignedAt: at('2026-11-03T08:00:00Z'), dueBy: '2026-11-04', setAt: null, setByUserId: 10, outcome: 'on_time', reconstructed: false },
          { taskId: 2, title: '', assignedAt: at('2026-11-04T08:00:00Z'), dueBy: '2026-11-05', setAt: null, setByUserId: null, outcome: 'late', reconstructed: false },
          // Before go-live - left out.
          { taskId: 1, title: '', assignedAt: at('2026-10-20T08:00:00Z'), dueBy: '2026-10-21', setAt: null, setByUserId: null, outcome: 'late', reconstructed: false },
        ],
      ],
    ]) as any,
    chargedChanges: new Map([
      [
        10,
        [
          { taskId: 2, title: '', at: at('2026-11-05T08:00:00Z'), byUserId: 10, initiatedByUserId: 10, oldDueDate: '2026-11-10', newDueDate: '2026-11-11', direction: 'later', reconstructed: false },
          { taskId: 2, title: '', at: at('2026-11-07T08:00:00Z'), byUserId: 10, initiatedByUserId: 10, oldDueDate: '2026-11-11', newDueDate: '2026-11-12', direction: 'later', reconstructed: false },
        ],
      ],
    ]) as any,
    changeSample: new Map([[10, 3]]),
    ...overrides,
  };
}

const get = (result: ReturnType<typeof computeTrackingMetrics>, userId: number, metric: string) => result.rows.find((r) => r.userId === userId && r.metric === metric)!;

describe('Performance Tracking B2 metrics (compute)', () => {
  const result = computeTrackingMetrics(input());

  it('the window starts at go-live, not before', () => {
    expect(result.windowFrom).toBe('2026-11-02');
  });

  it('working days and the median', () => {
    expect(workingDaysBetweenDays('2026-11-12', '2026-11-16', cal)).toBe(2);
    expect(workingDaysBetweenDays('2026-11-16', '2026-11-16', cal)).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('D1: on time against the date in force at submission; Junk left out', () => {
    expect(get(result, 10, 'D1')).toMatchObject({ value: 50, numerator: 1, denominator: 2, sample: 2, enoughData: false });
    expect((get(result, 10, 'D1').details as any).late).toEqual([{ taskId: 2, due: '2026-11-12', submitted: '2026-11-16', workingDaysLate: 2 }]);
  });

  it('D1: a task with an external blocker raised before submission is left out', () => {
    const r = computeTrackingMetrics(input({ flags: [...input().flags, flag({ taskId: 2, kind: 'blocker', external: true, blockingOwnerUserId: null, setAt: at('2026-11-13T08:00:00Z') })] }));
    expect(get(r, 10, 'D1')).toMatchObject({ value: 100, denominator: 1 });
    expect((get(r, 10, 'D1').details as any).leftOutExternal).toEqual([2]);
  });

  it('D2: coverage from the Non-Compliance items, assignments since go-live only', () => {
    expect(get(result, 10, 'D2')).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
  });

  it('D3: the slipped task had a risk raised 4 working days before its date', () => {
    expect(get(result, 10, 'D3')).toMatchObject({ value: 100, numerator: 1, denominator: 1 });
    const late = computeTrackingMetrics(input({ thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS, earlyWarningWorkingDays: 5 } }));
    expect(get(late, 10, 'D3')).toMatchObject({ value: 0, numerator: 0 });
  });

  it('D4: charged changes, tasks moved too often, slippage', () => {
    expect(get(result, 10, 'D4')).toMatchObject({ value: 2, sample: 3 });
    expect(get(result, 10, 'D4').details).toMatchObject({ later: 2, earlier: 0, tasksMovedTooOften: [{ taskId: 2, moves: 2 }], lateDeliveries: 1, slippageWorkingDays: 2 });
  });

  it('Q1 skips an exempt Not ready; Q2 never counts Not ready', () => {
    expect(get(result, 10, 'Q1')).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
    expect(get(result, 10, 'Q2')).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
    const strict = computeTrackingMetrics(input({ thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS, notReadyDeclaredDependencyExempt: false } }));
    expect((get(strict, 10, 'Q1').details as any).notAccepted).toEqual([{ taskId: 2, verdict: 'not_ready' }]);
    expect(get(strict, 10, 'Q2')).toMatchObject({ value: 50 });
  });

  it('Q3: a reopen within the window of its Pass', () => {
    expect(get(result, 10, 'Q3')).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
    const short = computeTrackingMetrics(input({ thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS, reopenWindowDays: 5 } }));
    expect(get(short, 10, 'Q3')).toMatchObject({ value: 0, numerator: 0 });
  });

  it('C2: the overdue ticket the person owns, and the blocker waiting on them', () => {
    expect(get(result, 10, 'C2')).toMatchObject({ value: 1, sample: 1 });
    expect(get(result, 10, 'C2').details).toMatchObject({ overdueWorkingDays: 2, blockedWorkingDays: 1 });
  });

  it('C5: fresh for 2 working days after landing, stale until the note, fresh again after it', () => {
    // 15 working days 2-20 Nov; fresh 2-4 and 12-16 Nov.
    expect(get(result, 20, 'C5')).toMatchObject({ value: 40, numerator: 6, denominator: 15 });
    expect((get(result, 20, 'C5').details as any).staleTaskIds).toEqual([5]);
  });

  it('O1: from the dependency going overdue to the assignee raising the blocker', () => {
    expect(get(result, 20, 'O1')).toMatchObject({ value: 1, sample: 1 });
    const created = computeTrackingMetrics(input({ thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS, blockerLagClockStart: 'dependency_created' } }));
    expect(get(created, 20, 'O1')).toMatchObject({ value: 4 });
  });

  it('O2: blocked-task ageing', () => {
    expect(get(result, 20, 'O2')).toMatchObject({ value: 1, sample: 1 });
  });

  it('O3: chases per 10 tasks due in the window', () => {
    expect(get(result, 10, 'O3')).toMatchObject({ value: 6.67, numerator: 2, denominator: 3 });
  });

  it('O5: an accepted improvement counts even as a single one', () => {
    expect(get(result, 10, 'O5')).toMatchObject({ value: 1, enoughData: true });
  });

  it('L1 and L2 on first submissions', () => {
    expect(get(result, 10, 'L1')).toMatchObject({ value: 100, numerator: 1, denominator: 1 });
    expect(get(result, 10, 'L2')).toMatchObject({ value: 100, numerator: 1, denominator: 1 });
    const bare = computeTrackingMetrics(input({ tasks: input().tasks.map((t) => (t.id === 4 ? { ...t, requirementId: null, clientImpact: 'short' } : t)) }));
    expect(get(bare, 10, 'L1')).toMatchObject({ value: 0 });
    expect(get(bare, 10, 'L2')).toMatchObject({ value: 0 });
  });

  it('nothing before go-live counts', () => {
    const late = computeTrackingMetrics(input({ trackingSince: at('2026-11-14T06:00:00Z') }));
    expect(late.windowFrom).toBe('2026-11-14');
    expect(get(late, 10, 'D1')).toMatchObject({ denominator: 1 });
    expect(get(late, 10, 'O5')).toMatchObject({ value: 0 });
  });
});
