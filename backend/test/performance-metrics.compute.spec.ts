import { addWorkingDays, commitmentDeadline, WorkingCalendar } from '../src/performance-metrics/working-days';
import {
  computePerformanceMetrics,
  MetricEvent,
  MetricRound,
  MetricTask,
  PERFORMANCE_SETTINGS_DEFAULTS,
  PerformanceSettings,
} from '../src/performance-metrics/performance-metrics.compute';
import { commitmentEventFromAudit } from '../src/performance-metrics/commitment-events';

// Pure rules for the performance metrics (2026-10-27). Addis Ababa is
// UTC+3 all year. 2026-10-26 is a Monday.
const cal: WorkingCalendar = { timeZone: 'Africa/Addis_Ababa', weekendDays: [0, 6], holidays: new Set() };
const at = (iso: string) => new Date(iso);

describe('working days', () => {
  it('Monday -> end of Tuesday, Friday -> end of Monday', () => {
    expect(commitmentDeadline(at('2026-10-26T09:00:00+03:00'), 1, cal)).toEqual({ dueBy: '2026-10-27', deadline: at('2026-10-28T00:00:00+03:00') });
    expect(commitmentDeadline(at('2026-10-23T16:00:00+03:00'), 1, cal).dueBy).toBe('2026-10-26');
  });

  it('a weekend assignment is due by the end of Monday', () => {
    expect(commitmentDeadline(at('2026-10-24T10:00:00+03:00'), 1, cal).dueBy).toBe('2026-10-26');
  });

  it('skips holidays', () => {
    const withHoliday = { ...cal, holidays: new Set(['2026-10-27']) };
    expect(commitmentDeadline(at('2026-10-26T09:00:00+03:00'), 1, withHoliday).dueBy).toBe('2026-10-28');
  });

  it('counts the assignment day in the team zone, not UTC', () => {
    // 22:30 UTC Monday is 01:30 Tuesday in Addis Ababa.
    expect(commitmentDeadline(at('2026-10-26T22:30:00Z'), 1, cal).dueBy).toBe('2026-10-28');
  });

  it('honours other weekend days and 0 = same day', () => {
    expect(addWorkingDays('2026-10-23', 1, { ...cal, weekendDays: [5, 6] })).toBe('2026-10-25');
    expect(addWorkingDays('2026-10-26', 0, cal)).toBe('2026-10-26');
  });
});

describe('commitment events from audit entries', () => {
  const entry = (action: string, details: any) => ({
    id: 1,
    tenantId: 1,
    action,
    entityType: 'ProjectTask',
    entityId: 7,
    userId: 3,
    userRole: 'program_manager',
    createdAt: at('2026-10-26T09:00:00Z'),
    details,
  });

  it('turns each kind of entry into the right event', () => {
    expect(commitmentEventFromAudit(entry('task_created', { assigneeUserId: 5 }))?.kind).toBe('assigned');
    expect(commitmentEventFromAudit(entry('task_created', { assigneeUserId: null }))).toBeNull();
    expect(commitmentEventFromAudit(entry('task_reassigned', { previousAssigneeUserId: 5, assigneeUserId: null }))).toMatchObject({ kind: 'unassigned', previousAssigneeUserId: 5 });
    expect(commitmentEventFromAudit(entry('task_reassigned', { previousAssigneeUserId: 5, assigneeUserId: 5 }))).toBeNull();
    expect(commitmentEventFromAudit(entry('task_updated', { previous: { dueDate: null, assigneeUserId: 5 }, updated: { dueDate: '2026-10-30' } }))).toMatchObject({
      kind: 'due_set',
      assigneeUserId: 5,
      newDueDate: '2026-10-30',
    });
    expect(commitmentEventFromAudit(entry('task_updated', { previous: { dueDate: '2026-10-30' }, updated: { dueDate: '2026-11-02' } }))).toMatchObject({
      kind: 'due_changed',
      direction: 'later',
    });
    expect(commitmentEventFromAudit(entry('task_updated', { previous: { dueDate: '2026-10-30' }, updated: { dueDate: null } }))?.kind).toBe('due_cleared');
    expect(commitmentEventFromAudit(entry('task_updated', { previous: { dueDate: '2026-10-30' }, updated: { title: 'x' } }))).toBeNull();
    expect(commitmentEventFromAudit(entry('task_qa_approved', {}))).toBeNull();
  });
});

describe('computePerformanceMetrics', () => {
  const DEV = 10;
  const DEV2 = 11;
  const PM = 99;
  const people = [
    { id: DEV, fullName: 'Dev One', email: 'dev1@x', role: 'developer' },
    { id: DEV2, fullName: 'Dev Two', email: 'dev2@x', role: 'developer' },
  ];
  let auditId = 0;
  const ev = (taskId: number, kind: MetricEvent['kind'], iso: string, extra: Partial<MetricEvent> = {}): MetricEvent => ({
    taskId,
    kind,
    assigneeUserId: kind === 'assigned' ? DEV : null,
    actorUserId: PM,
    occurredAt: at(iso),
    newDueDate: null,
    source: 'live',
    auditLogId: ++auditId,
    ...extra,
  });
  const task = (id: number, extra: Partial<MetricTask> = {}): MetricTask => ({
    id,
    title: `Task ${id}`,
    status: 'Development',
    createdAt: at('2026-10-01T08:00:00+03:00'),
    assigneeUserId: DEV,
    dueDate: '2026-11-30',
    completedAt: null,
    ...extra,
  });
  const run = (tasks: MetricTask[], events: MetricEvent[], rounds: MetricRound[] = [], settings: Partial<PerformanceSettings> = {}, holidays: string[] = []) =>
    computePerformanceMetrics({
      now: at('2026-10-30T12:00:00+03:00'),
      to: '2026-10-30',
      settings: { ...PERFORMANCE_SETTINGS_DEFAULTS, ...settings },
      holidays,
      people,
      tasks,
      events,
      rounds,
    });
  const dev = (r: ReturnType<typeof run>, id = DEV) => r.people.find((p) => p.userId === id)!;

  describe('date set on time', () => {
    it('judges on time, late, not set, still running and moved on', () => {
      const r = run(
        [task(1), task(2), task(3), task(4, { dueDate: null }), task(5, { dueDate: null })],
        [
          // Assigned Monday, set Tuesday 17:00 -> on time.
          ev(1, 'assigned', '2026-10-26T09:00:00+03:00'),
          ev(1, 'due_set', '2026-10-27T17:00:00+03:00', { assigneeUserId: DEV, actorUserId: DEV, newDueDate: '2026-11-30' }),
          // Assigned Friday, set Tuesday -> late.
          ev(2, 'assigned', '2026-10-23T09:00:00+03:00'),
          ev(2, 'due_set', '2026-10-27T09:00:00+03:00', { assigneeUserId: DEV, actorUserId: DEV, newDueDate: '2026-11-30' }),
          // Set at 00:00 on the day after the deadline -> late.
          ev(3, 'assigned', '2026-10-26T09:00:00+03:00'),
          ev(3, 'due_set', '2026-10-28T00:00:00+03:00', { assigneeUserId: DEV, actorUserId: DEV, newDueDate: '2026-11-30' }),
          // Never set, deadline passed -> not set.
          ev(4, 'assigned', '2026-10-26T09:00:00+03:00'),
          // Assigned Thursday, deadline end of Friday (after "now") -> not counted yet.
          ev(5, 'assigned', '2026-10-29T09:00:00+03:00'),
        ],
      );
      const d = dev(r).onTime;
      expect(d.items.map((i) => [i.taskId, i.outcome])).toEqual([
        [1, 'on_time'],
        [2, 'late'],
        [3, 'late'],
        [4, 'not_set'],
      ]);
      expect(d).toMatchObject({ counted: 4, onTime: 1, late: 3, percent: 25, status: 'not_enough_data' });
    });

    it('reassignment restarts the clock for the new assignee', () => {
      const r = run(
        [task(1, { assigneeUserId: DEV2 }), task(2, { assigneeUserId: DEV2 })],
        [
          // Moved to DEV2 before DEV's deadline, DEV2 sets it on time.
          ev(1, 'assigned', '2026-10-26T09:00:00+03:00'),
          ev(1, 'assigned', '2026-10-26T15:00:00+03:00', { assigneeUserId: DEV2 }),
          ev(1, 'due_set', '2026-10-27T10:00:00+03:00', { assigneeUserId: DEV2, actorUserId: DEV2, newDueDate: '2026-11-30' }),
          // Dated by DEV, then reassigned -> already dated for DEV2.
          ev(2, 'assigned', '2026-10-19T09:00:00+03:00'),
          ev(2, 'due_set', '2026-10-19T10:00:00+03:00', { assigneeUserId: DEV, actorUserId: DEV, newDueDate: '2026-11-30' }),
          ev(2, 'assigned', '2026-10-26T09:00:00+03:00', { assigneeUserId: DEV2 }),
        ],
      );
      expect(dev(r).onTime.items.map((i) => [i.taskId, i.outcome])).toEqual([[2, 'on_time']]);
      expect(dev(r, DEV2).onTime.items.map((i) => [i.taskId, i.outcome])).toEqual([
        [1, 'on_time'],
        [2, 'already_dated'],
      ]);
      const strict = run(
        [task(2, { assigneeUserId: DEV2 })],
        [
          ev(2, 'assigned', '2026-10-19T09:00:00+03:00'),
          ev(2, 'due_set', '2026-10-19T10:00:00+03:00', { assigneeUserId: DEV, actorUserId: DEV, newDueDate: '2026-11-30' }),
          ev(2, 'assigned', '2026-10-26T09:00:00+03:00', { assigneeUserId: DEV2 }),
        ],
        [],
        { alreadyDatedCountsOnTime: false },
      );
      expect(dev(strict, DEV2).onTime.items.map((i) => i.outcome)).toEqual(['not_set']);
    });

    it('a date set by the PM counts unless the setting says otherwise', () => {
      const events = [
        ev(1, 'assigned', '2026-10-26T09:00:00+03:00'),
        ev(1, 'due_set', '2026-10-26T10:00:00+03:00', { assigneeUserId: DEV, actorUserId: PM, newDueDate: '2026-11-30' }),
      ];
      expect(dev(run([task(1)], events)).onTime.items[0].outcome).toBe('on_time');
      expect(dev(run([task(1)], events, [], { othersSettingDateCountsOnTime: false })).onTime.items[0].outcome).toBe('set_by_other');
    });

    it('uses the holiday list and only counts deadlines inside the window', () => {
      const events = [
        ev(1, 'assigned', '2026-10-26T09:00:00+03:00'),
        ev(1, 'due_set', '2026-10-28T09:00:00+03:00', { assigneeUserId: DEV, actorUserId: DEV, newDueDate: '2026-11-30' }),
        // Deadline 2026-09-29, before the 4-week window (2026-10-03 to 10-30).
        ev(2, 'assigned', '2026-09-28T09:00:00+03:00'),
      ];
      expect(dev(run([task(1), task(2, { dueDate: null })], events)).onTime.items.map((i) => [i.taskId, i.outcome])).toEqual([[1, 'late']]);
      expect(dev(run([task(1)], events, [], {}, ['2026-10-27'])).onTime.items[0].outcome).toBe('on_time');
    });

    it('takes a bulk-imported task with no recorded assignment as assigned at creation', () => {
      const r = run(
        [task(1, { createdAt: at('2026-10-26T09:00:00+03:00') })],
        [ev(1, 'due_set', '2026-10-26T11:00:00+03:00', { assigneeUserId: DEV, actorUserId: DEV, newDueDate: '2026-11-30' })],
      );
      expect(dev(r).onTime.items[0]).toMatchObject({ outcome: 'on_time', reconstructed: true });
    });
  });

  describe('due date changes', () => {
    it('counts changes after the first commitment, later and earlier apart, clear + set again as one', () => {
      const r = run(
        [task(1), task(2)],
        [
          ev(1, 'assigned', '2026-10-05T09:00:00+03:00'),
          ev(1, 'due_set', '2026-10-05T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: '2026-10-20' }),
          ev(1, 'due_changed', '2026-10-12T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: '2026-10-25' }),
          ev(1, 'due_changed', '2026-10-13T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: '2026-10-22' }),
          ev(1, 'due_cleared', '2026-10-14T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: null }),
          ev(1, 'due_set', '2026-10-15T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: '2026-10-29' }),
          ev(2, 'assigned', '2026-10-05T09:00:00+03:00'),
          ev(2, 'due_set', '2026-10-05T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: '2026-10-20' }),
        ],
      );
      const c = dev(r).dueChanges;
      expect(c.items.map((i) => [i.oldDueDate, i.newDueDate, i.direction])).toEqual([
        ['2026-10-20', '2026-10-25', 'later'],
        ['2026-10-25', '2026-10-22', 'earlier'],
        ['2026-10-22', '2026-10-29', 'later'],
      ]);
      expect(c).toMatchObject({ tasks: 2, changes: 3, later: 2, earlier: 1, perTask: 1.5 });
    });

    it('counts a change against whoever was assignee at the time, and not before the window', () => {
      const r = run(
        [task(1, { assigneeUserId: DEV2 })],
        [
          ev(1, 'assigned', '2026-09-01T09:00:00+03:00'),
          ev(1, 'due_set', '2026-09-01T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: '2026-09-20' }),
          ev(1, 'due_changed', '2026-09-10T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: '2026-09-25' }),
          ev(1, 'assigned', '2026-10-10T09:00:00+03:00', { assigneeUserId: DEV2 }),
          ev(1, 'due_changed', '2026-10-12T10:00:00+03:00', { assigneeUserId: DEV2, newDueDate: '2026-10-30' }),
        ],
      );
      expect(dev(r).dueChanges).toMatchObject({ changes: 0, tasks: 1 });
      expect(dev(r, DEV2).dueChanges).toMatchObject({ changes: 1, tasks: 1, perTask: 1 });
    });

    it('leaves out tasks finished before the window', () => {
      const r = run(
        [task(1, { completedAt: at('2026-09-15T10:00:00+03:00') })],
        [ev(1, 'assigned', '2026-09-01T09:00:00+03:00'), ev(1, 'due_set', '2026-09-01T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: '2026-09-20' })],
      );
      expect(dev(r).dueChanges.tasks).toBe(0);
    });
  });

  describe('QA acceptance', () => {
    let roundNo = 0;
    const round = (taskId: number, submitted: string, status: string, extra: Partial<MetricRound> = {}): MetricRound => ({
      taskId,
      roundNumber: ++roundNo,
      submittedByUserId: DEV,
      submittedAt: at(submitted),
      status,
      reviewType: 'qa',
      reviewedAt: status === 'pending' || status === 'withdrawn' ? null : at('2026-10-20T12:00:00+03:00'),
      revertedDecision: null,
      ...extra,
    });

    it('counts each submission once, by its standing decision', () => {
      const r = run(
        [task(1), task(2), task(3), task(4)],
        [],
        [
          // Task 1: rejected, then resubmitted and approved.
          round(1, '2026-10-10T09:00:00+03:00', 'rejected'),
          round(1, '2026-10-15T09:00:00+03:00', 'approved'),
          // Task 2: QA rejected, the PM reverted it, QA then approved - one submission, approved.
          round(2, '2026-10-12T09:00:00+03:00', 'reverted', { revertedDecision: 'rejected' }),
          round(2, '2026-10-12T09:00:00+03:00', 'approved'),
          // Task 3: PM review gate round, a withdrawn round, then pending - nothing decided.
          round(3, '2026-10-12T09:00:00+03:00', 'rejected', { reviewType: 'pm' }),
          round(3, '2026-10-13T09:00:00+03:00', 'withdrawn'),
          round(3, '2026-10-14T09:00:00+03:00', 'pending'),
          // Task 4: Peer Review approval and a QA escalation - neither counts by default.
          round(4, '2026-10-12T09:00:00+03:00', 'approved', { reviewType: 'peer' }),
          round(4, '2026-10-14T09:00:00+03:00', 'escalated'),
        ],
      );
      const q = dev(r).qa;
      expect(q).toMatchObject({ decided: 3, accepted: 2, rejected: 1, acceptedPercent: 66.7, rejectedPercent: 33.3 });
      expect(q.firstSubmission).toMatchObject({ decided: 2, accepted: 1, rejected: 1, acceptedPercent: 50 });
      expect(q.items.find((i) => i.taskId === 2)).toMatchObject({ decision: 'approved', revertedFrom: 'rejected', isFirstSubmission: true });

      const wide = dev(
        run([task(4)], [], [round(4, '2026-10-12T09:00:00+03:00', 'approved', { reviewType: 'peer' }), round(4, '2026-10-14T09:00:00+03:00', 'escalated')], {
          includePeerReview: true,
          countEscalatedAsDecided: true,
        }),
      ).qa;
      expect(wide).toMatchObject({ decided: 2, accepted: 1, rejected: 0, acceptedPercent: 50 });
    });

    it('a "Not ready for testing" return is no decision, and the resubmission is still the first submission', () => {
      const r = run(
        [task(1)],
        [],
        [round(1, '2026-10-10T09:00:00+03:00', 'not_ready'), round(1, '2026-10-15T09:00:00+03:00', 'rejected')],
      );
      const q = dev(r).qa;
      expect(q).toMatchObject({ decided: 1, accepted: 0, rejected: 1 });
      expect(q.firstSubmission).toMatchObject({ decided: 1, rejected: 1 });
      expect(q.items).toEqual([expect.objectContaining({ taskId: 1, decision: 'rejected', isFirstSubmission: true })]);
    });

    it('counts a submission in the window by its decision time', () => {
      const r = run([task(1)], [], [round(1, '2026-09-20T09:00:00+03:00', 'approved', { reviewedAt: at('2026-09-21T09:00:00+03:00') })]);
      expect(dev(r).qa.decided).toBe(0);
    });
  });

  describe('status', () => {
    const fiveOnTime = (okCount: number) => {
      const tasks: MetricTask[] = [];
      const events: MetricEvent[] = [];
      for (let i = 1; i <= 5; i++) {
        tasks.push(task(i));
        events.push(ev(i, 'assigned', '2026-10-26T09:00:00+03:00'));
        const setAt = i <= okCount ? '2026-10-26T10:00:00+03:00' : '2026-10-29T10:00:00+03:00';
        events.push(ev(i, 'due_set', setAt, { assigneeUserId: DEV, newDueDate: '2026-11-30' }));
      }
      return run(tasks, events);
    };

    it('OK at the threshold, Needs attention below, not enough data under the minimum', () => {
      expect(dev(fiveOnTime(5)).onTime).toMatchObject({ percent: 100, status: 'ok' });
      expect(dev(fiveOnTime(5)).status).toBe('ok');
      expect(dev(fiveOnTime(4)).onTime).toMatchObject({ percent: 80, status: 'needs_attention' });
      expect(dev(fiveOnTime(4)).status).toBe('needs_attention');
      expect(dev(fiveOnTime(4), DEV2).status).toBe('not_enough_data');
    });

    it('uses the thresholds from the settings', () => {
      const tasks: MetricTask[] = [];
      const events: MetricEvent[] = [];
      for (let i = 1; i <= 5; i++) {
        tasks.push(task(i));
        events.push(ev(i, 'assigned', '2026-10-26T09:00:00+03:00'));
        events.push(ev(i, 'due_set', i <= 4 ? '2026-10-26T10:00:00+03:00' : '2026-10-29T10:00:00+03:00', { assigneeUserId: DEV, newDueDate: '2026-11-30' }));
      }
      expect(dev(run(tasks, events, [], { onTimeOkPercent: 80 })).onTime.status).toBe('ok');
      expect(dev(run(tasks, events, [], { minSample: 6 })).onTime.status).toBe('not_enough_data');
    });
  });
});
