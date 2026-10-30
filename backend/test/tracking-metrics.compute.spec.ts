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

  it('C2: working days others waited on the person - overdue ticket and blocker flag on the same task count once', () => {
    // Ticket overdue Fri 6 Nov, resolved Tue 10 Nov: Mon 9 + Tue 10. The
    // blocker (Mon 9 -> Tue 10) adds Tue 10, already counted.
    expect(get(result, 10, 'C2')).toMatchObject({ value: 2, numerator: 2, sample: 2 });
    expect(get(result, 10, 'C2').details).toMatchObject({ blockedTasks: [{ taskId: 5, workingDays: 2 }], overdue: [{ ticketId: 1, taskId: 5, overdueWorkingDays: 2 }], blockerFlags: 1 });
    // Their own task waiting on them, and external blockers, never count.
    const base = input();
    const own = computeTrackingMetrics(
      input({
        flags: [
          ...base.flags,
          flag({ taskId: 2, kind: 'blocker', blockingOwnerUserId: 10, setAt: at('2026-11-16T08:00:00Z'), clearedAt: at('2026-11-18T08:00:00Z') }),
          flag({ taskId: 5, kind: 'blocker', assigneeUserId: 20, external: true, blockingOwnerUserId: 10, setAt: at('2026-11-16T08:00:00Z') }),
        ],
      }),
    );
    expect(get(own, 10, 'C2')).toMatchObject({ value: 2 });
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

  it('Q4: production defects within 30 days of release, charged to the passing submitter, per 10 tasks released', () => {
    const base = input();
    const defect = (id: number, extra: any) =>
      task(id, { isDefect: true, foundInProduction: true, assigneeUserId: 20, createdAt: at('2026-11-16T08:00:00Z'), ...extra });
    const q4 = computeTrackingMetrics(
      input({
        tasks: [
          ...base.tasks,
          // Counts: 4 days after task 1's release.
          defect(7, { escapedFromTaskId: 1, productionReleaseDate: '2026-11-12' }),
          // Released more than 30 days before it was found - left out.
          defect(8, { escapedFromTaskId: 2, productionReleaseDate: '2026-10-01' }),
          // No source task - charged to nobody.
          defect(9, { escapedFromTaskId: null, productionReleaseDate: '2026-11-12' }),
          // Not marked - ignored.
          defect(10, { foundInProduction: false, escapedFromTaskId: 1, productionReleaseDate: '2026-11-12' }),
        ],
        // Tasks 1 and 2 in the Release Log (task 1 twice - the first date counts).
        releaseLog: [
          { taskId: 1, releaseDate: '2026-11-12' },
          { taskId: 1, releaseDate: '2026-11-19' },
          { taskId: 2, releaseDate: '2026-11-18' },
        ],
        // Task 5 released by status; nobody passed it, so its assignee answers for it.
        statusEvents: [...base.statusEvents, { taskId: 5, toStatus: 'Released - No Showstoppers', occurredAt: at('2026-11-19T08:00:00Z'), actorUserId: 99 }],
      }),
    );
    expect(get(q4, 10, 'Q4')).toMatchObject({ value: 5, numerator: 1, denominator: 2, sample: 2 });
    expect((get(q4, 10, 'Q4').details as any).escaped).toEqual([{ defectId: 7, sourceTaskId: 1, releaseDate: '2026-11-12', foundOn: '2026-11-16' }]);
    expect(get(q4, 20, 'Q4')).toMatchObject({ value: 0, numerator: 0, denominator: 1 });
    // A shorter window drops defect 7 too.
    const short = computeTrackingMetrics({ ...input(), tasks: [...base.tasks, defect(7, { escapedFromTaskId: 1, productionReleaseDate: '2026-11-12' })], releaseLog: [{ taskId: 1, releaseDate: '2026-11-12' }], thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS, escapeWindowDays: 3 } });
    expect(get(short, 10, 'Q4')).toMatchObject({ value: 0, denominator: 1 });
    // Nothing released: no value.
    expect(get(result, 10, 'Q4')).toMatchObject({ value: null, sample: 0 });
  });

  it('Q5: the average technical review score in the window; one review is enough', () => {
    const q5 = computeTrackingMetrics(
      input({
        techReviews: [
          { id: 1, revieweeUserId: 10, reviewedAt: at('2026-11-10T08:00:00Z'), average: 4 },
          { id: 2, revieweeUserId: 10, reviewedAt: at('2026-11-12T08:00:00Z'), average: 3 },
          // Before go-live - left out.
          { id: 3, revieweeUserId: 10, reviewedAt: at('2026-10-20T08:00:00Z'), average: 1 },
          { id: 4, revieweeUserId: 20, reviewedAt: at('2026-11-12T08:00:00Z'), average: 5 },
        ],
      }),
    );
    expect(get(q5, 10, 'Q5')).toMatchObject({ value: 3.5, sample: 2, enoughData: true });
    expect((get(q5, 10, 'Q5').details as any).reviewIds).toEqual([1, 2]);
    expect(get(q5, 20, 'Q5')).toMatchObject({ value: 5, sample: 1, enoughData: true });
    expect(get(result, 10, 'Q5')).toMatchObject({ value: null, enoughData: false });
  });

  it('C3: weekly report deadlines passed in the window - on time, late, missing', () => {
    // Deadlines Thu 5, 12, 19 Nov 17:00 EAT (14:00Z).
    const c3 = computeTrackingMetrics(
      input({
        weeklyStatus: [
          { userId: 10, weekStart: '2026-11-02', submittedAt: at('2026-11-05T10:00:00Z'), deadlineAt: at('2026-11-05T14:00:00Z') },
          { userId: 10, weekStart: '2026-11-09', submittedAt: at('2026-11-12T15:00:00Z'), deadlineAt: at('2026-11-12T14:00:00Z') },
        ],
      }),
    );
    expect(get(c3, 10, 'C3')).toMatchObject({ value: 33.33, numerator: 1, denominator: 3, sample: 3, enoughData: true });
    expect(get(c3, 10, 'C3').details).toEqual({ late: ['2026-11-09'], missing: ['2026-11-16'] });
    expect(get(c3, 20, 'C3')).toMatchObject({ value: 0, denominator: 3 });
    // A Friday 12:00 deadline: the week of 16 Nov's is on the 20th (12:00
    // EAT, before the 23:30Z run), so still 3 weeks.
    const friday = computeTrackingMetrics(input({ thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS, weeklyReportDeadlineDay: 5, weeklyReportDeadlineTime: '12:00' } }));
    expect(get(friday, 10, 'C3')).toMatchObject({ denominator: 3 });
    // A Saturday deadline (team weekend still counts): 7 and 14 Nov passed, 21 Nov not yet.
    const saturday = computeTrackingMetrics(input({ thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS, weeklyReportDeadlineDay: 6 } }));
    expect(get(saturday, 10, 'C3')).toMatchObject({ denominator: 2 });
  });

  it('C4: accepted share of the handovers the person gave, decided in the window', () => {
    const c4 = computeTrackingMetrics(
      input({
        handovers: [
          { id: 1, taskId: 1, fromUserId: 10, status: 'accepted', decidedAt: at('2026-11-10T08:00:00Z') },
          { id: 2, taskId: 2, fromUserId: 10, status: 'rejected', decidedAt: at('2026-11-11T08:00:00Z') },
          { id: 3, taskId: 2, fromUserId: 10, status: 'accepted', decidedAt: at('2026-11-12T08:00:00Z') },
          // Before go-live - left out.
          { id: 4, taskId: 4, fromUserId: 10, status: 'rejected', decidedAt: at('2026-10-20T08:00:00Z') },
        ],
      }),
    );
    expect(get(c4, 10, 'C4')).toMatchObject({ value: 66.67, numerator: 2, denominator: 3 });
    expect(get(c4, 10, 'C4').details).toEqual({ rejectedTaskIds: [2] });
    expect(get(result, 10, 'C4')).toMatchObject({ value: null, sample: 0 });
  });

  it('O4: avoidable escalations per 10 QA rounds the person submitted', () => {
    const base = input();
    const o4 = computeTrackingMetrics(
      input({
        rounds: [
          ...base.rounds,
          round(4, 'escalated', '2026-11-18T09:00:00Z', '2026-11-19T08:00:00Z', { escalationReasonCode: 'developer_unresponsive', escalationAvoidable: true }),
          round(1, 'escalated', '2026-11-05T09:00:00Z', '2026-11-06T08:00:00Z', { escalationReasonCode: 'requirement_unclear', escalationAvoidable: false }),
        ],
      }),
    );
    // QA rounds decided in the window by 10: task 1 pass, task 2 not ready + fail + pass, the 2 escalations = 6.
    expect(get(o4, 10, 'O4')).toMatchObject({ numerator: 1, denominator: 6, sample: 6 });
    expect(get(o4, 10, 'O4').value).toBeCloseTo(1.67, 2);
    expect(get(o4, 10, 'O4').details).toMatchObject({ avoidableTaskIds: [4], escalations: 2, byReason: { developer_unresponsive: 1, requirement_unclear: 1 } });
    expect(get(result, 10, 'O4')).toMatchObject({ value: 0, numerator: 0, denominator: 4 });
  });

  it('P1/P2: releases the person did in the window - staging sign-off on or before the release date, change ticket', () => {
    const rel = (id: number, releaseDate: string, extra: any = {}) => ({ id, releaseDate, releasedByUserId: 10, stagingSignedOffOn: null, changeTicketRef: null, ...extra });
    const p = computeTrackingMetrics(
      input({
        releases: [
          rel(1, '2026-11-05', { stagingSignedOffOn: '2026-11-04', changeTicketRef: 'CHG-1' }),
          rel(2, '2026-11-10', { stagingSignedOffOn: '2026-11-10' }),
          rel(3, '2026-11-12', { stagingSignedOffOn: '2026-11-13', changeTicketRef: ' ' }),
          rel(4, '2026-11-18', { changeTicketRef: 'https://changes.example.com/7' }),
          rel(5, '2026-10-30', { stagingSignedOffOn: '2026-10-29', changeTicketRef: 'CHG-0' }),
          rel(6, '2026-11-11', { releasedByUserId: 20, stagingSignedOffOn: '2026-11-10' }),
          rel(7, '2026-11-11', { releasedByUserId: null }),
        ],
      }),
    );
    // Person 10: releases 1-4 (5 is before go-live). On path: 1 and 2 (same day counts); 3 signed off after.
    expect(get(p, 10, 'P1')).toMatchObject({ value: 50, numerator: 2, denominator: 4, sample: 4 });
    expect(get(p, 10, 'P1').details).toEqual({ windowFrom: '2026-11-02', windowDays: 90, releaseIds: [1, 2, 3, 4], noSignOff: [4], signedOffAfterRelease: [3] });
    expect(get(p, 10, 'P2')).toMatchObject({ value: 50, numerator: 2, denominator: 4 });
    expect(get(p, 10, 'P2').details).toEqual({ windowFrom: '2026-11-02', windowDays: 90, noTicket: [2, 3] });
    // Person 10 has 4 releases (>= 3): enough data; person 20 has 1: not enough.
    expect(get(p, 10, 'P1')).toMatchObject({ enoughData: true });
    expect(get(p, 20, 'P1')).toMatchObject({ value: 100, sample: 1, enoughData: false });
    expect(get(result, 10, 'P1')).toMatchObject({ value: null, sample: 0, enoughData: false });
  });

  it('P1/P2: their own window (default 90 days, never before go-live) and minimum releases (default 3)', () => {
    const rel = (id: number, releaseDate: string) => ({ id, releaseDate, releasedByUserId: 10, stagingSignedOffOn: releaseDate, changeTicketRef: 'CHG' });
    const releases = [rel(1, '2026-08-01'), rel(2, '2026-09-10'), rel(3, '2026-10-01'), rel(4, '2026-11-18')];
    // Go-live long ago: the 90-day window to 20 Nov starts 23 Aug, so release 1 is out; the 28-day window would keep only release 4.
    const early = { trackingSince: at('2026-01-05T06:00:00Z'), releases };
    const p = computeTrackingMetrics(input(early));
    expect(get(p, 10, 'P1')).toMatchObject({ numerator: 3, denominator: 3, enoughData: true });
    expect(get(p, 10, 'P1').details).toMatchObject({ windowFrom: '2026-08-23', windowDays: 90, releaseIds: [2, 3, 4] });
    const strict = computeTrackingMetrics(input({ ...early, thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS, releaseWindowDays: 60, releaseMinSample: 4 } }));
    expect(get(strict, 10, 'P2')).toMatchObject({ denominator: 2, enoughData: false });
    // Go-live 2 Nov caps the window.
    expect(get(computeTrackingMetrics(input({ releases })), 10, 'P1')).toMatchObject({ denominator: 1 });
  });

  it('nothing before go-live counts', () => {
    const late = computeTrackingMetrics(input({ trackingSince: at('2026-11-14T06:00:00Z') }));
    expect(late.windowFrom).toBe('2026-11-14');
    expect(get(late, 10, 'D1')).toMatchObject({ denominator: 1 });
    expect(get(late, 10, 'O5')).toMatchObject({ value: 0 });
  });
});
