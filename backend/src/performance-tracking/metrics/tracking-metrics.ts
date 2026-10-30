// Performance Tracking B2 (2026-10-30, fast-track plan approved by the
// user) - the Wave 1 metrics, per person per project, for one night.
// Pure - no Nest/TypeORM imports - so it is tested with a fixed date.
//
// Window: the shared rolling window (performance_metric_settings.
// windowDays, default 28) ending on the snapshot day, in the team's time
// zone - but never before the project's go-live date: nothing that
// happened before tracking was switched on counts. Working days use the
// team's weekend days and holiday list. Tasks now in Junk are left out.
// Measured: Developer, Designer and DevOps.
//
// Every rule still waiting for the Technical Director reads a setting
// (performance_tracking_settings) - the defaults are listed for the TD in
// /home/ec2-user/perf-tracking-defaults.md. Scoring (1-5 bands) is B3;
// this stage stores the raw value, its sample and whether the sample
// reaches the minimum.
//
//  D1 On-time delivery (%) - each QA Pass in the window, charged to who
//     submitted the passing round: on time if submitted (QA queue time not
//     charged) on or before the Due date in force at submission. No Due
//     date = late. Tasks with an external blocker raised before the
//     submission are left out.
//  D2 Commitment coverage (%) - the Non-Compliance "Due date set on time"
//     items (computePerformanceMetrics), assignments in the window only.
//  D3 Early warning (%) - of the person's slipped tasks (D1 late, or an
//     assignee-started later Due date change), the share with a risk flag
//     the assignee raised at least earlyWarningWorkingDays before the date.
//  D4 Re-commits (count) - assignee-started Due date changes in the window
//     (approved requests count for the requester, PM/Admin direct changes
//     never). Details: later/earlier, tasks moved dateMovesFlagCount+
//     times, working days late summed over D1 late deliveries.
//  Q1 First-time QA acceptance (%) - each task's first QA verdict (Pass,
//     Test failed or Not ready), charged to its submitter, in the window
//     by verdict time. A Not ready with the dependency exemption is
//     skipped when notReadyDeclaredDependencyExempt is on.
//  Q2 First-pass test rate (%) - the same, but Not ready is never a test:
//     the first Pass/Test failed verdict.
//  Q3 Reopen rate (%) - reopens after Pass charged to the person within
//     reopenWindowDays of the Pass, per QA Pass of theirs in the window.
//  C2 Dependency wait caused (count) - dependency tickets the person owns
//     that were overdue at some point in the window. Details: overdue
//     working days, and working days tasks sat blocked on them (internal
//     blockers only - external owners are never charged).
//  C5 Status freshness (%) - each working day in the window, each of the
//     person's tasks in Development/Failed/PM Feedback: fresh if the
//     assignee changed its status or wrote a progress note within
//     statusFreshWorkingDays working days, counting from when the task
//     landed on them (assigned, or moved back into one of those statuses).
//  O1 Blocker raise lag (working days, median) - from the clock start
//     (blockerLagClockStart) to the first blocker flag the assignee raised
//     on the task (or the ticket's resolution, or now).
//  O2 Blocked-task ageing (working days, average) - blocker flags on the
//     person's tasks open at some point in the window: set to cleared (or
//     the end of the snapshot day).
//  O3 Chase only (rate) - chases of the person in the window per
//     chasesPerTasks of their tasks due in the window.
//  O5 Self-initiated improvements (count) - Improvements the person
//     created that a PM accepted in the window.
//  L1 Requirement traceability (%) - Feature tasks first submitted by the
//     person in the window that carry a requirement ID.
//  L2 Client impact (%) - Feature and Improvement tasks first submitted in
//     the window with a client impact of 20+ characters.
import { dateInZone, startOfDayInZone } from '../../team-settings/time-zone';
import { WorkingCalendar, addCalendarDays, isWorkingDay } from '../../performance-metrics/working-days';
import { OnTimeItem, DueChangeItem } from '../../performance-metrics/performance-metrics.compute';
import { PerformanceTrackingThresholds } from '../performance-tracking';

export const TRACKING_METRICS = ['D1', 'D2', 'D3', 'D4', 'Q1', 'Q2', 'Q3', 'C2', 'C5', 'O1', 'O2', 'O3', 'O5', 'L1', 'L2'] as const;
export type TrackingMetric = (typeof TRACKING_METRICS)[number];

// What the value is, and which way is better - for the scorecard (B3).
export const METRIC_INFO: Record<TrackingMetric, { label: string; unit: 'percent' | 'count' | 'days' | 'rate'; higherIsBetter: boolean }> = {
  D1: { label: 'On-time delivery', unit: 'percent', higherIsBetter: true },
  D2: { label: 'Commitment coverage', unit: 'percent', higherIsBetter: true },
  D3: { label: 'Early-warning rate', unit: 'percent', higherIsBetter: true },
  D4: { label: 'Re-commits', unit: 'count', higherIsBetter: false },
  Q1: { label: 'First-time QA acceptance', unit: 'percent', higherIsBetter: true },
  Q2: { label: 'First-pass test rate', unit: 'percent', higherIsBetter: true },
  Q3: { label: 'Reopen rate', unit: 'percent', higherIsBetter: false },
  C2: { label: 'Dependency wait caused', unit: 'count', higherIsBetter: false },
  C5: { label: 'Status freshness', unit: 'percent', higherIsBetter: true },
  O1: { label: 'Blocker raise lag', unit: 'days', higherIsBetter: false },
  O2: { label: 'Blocked-task ageing', unit: 'days', higherIsBetter: false },
  O3: { label: 'Chase only', unit: 'rate', higherIsBetter: false },
  O5: { label: 'Self-initiated improvements', unit: 'count', higherIsBetter: true },
  L1: { label: 'Requirement traceability', unit: 'percent', higherIsBetter: true },
  L2: { label: 'Client impact statement', unit: 'percent', higherIsBetter: true },
};

// C5: the statuses where the task is the assignee's to move.
export const FRESHNESS_ACTIVE_STATUSES = ['Development', 'Failed', 'PM Feedback'];
export const CLIENT_IMPACT_MIN = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TmTask {
  id: number;
  status: string;
  assigneeUserId: number | null;
  createdByUserId: number | null;
  dueDate: string | null;
  isDefect: boolean;
  taskType: string | null;
  requirementId: string | null;
  clientImpact: string | null;
  improvementDecision: string | null;
  improvementDecidedAt: Date | null;
}

export interface TmRound {
  taskId: number;
  submittedByUserId: number;
  submittedAt: Date;
  status: string;
  reviewType: string;
  reviewedAt: Date | null;
  dependencyExempt: boolean | null;
}

// Assignment and Due date events (task_commitment_events).
export interface TmCommitmentEvent {
  taskId: number;
  kind: string;
  assigneeUserId: number | null;
  occurredAt: Date;
  newDueDate: string | null;
}

export interface TmFlag {
  taskId: number;
  kind: 'risk' | 'blocker';
  setByAssignee: boolean;
  assigneeUserId: number | null;
  committedDueDateAtSet: string | null;
  blockingOwnerUserId: number | null;
  external: boolean;
  dependencyTicketId: number | null;
  setAt: Date;
  clearedAt: Date | null;
}

export interface TmTicket {
  id: number;
  parentTaskId: number;
  ownerUserId: number;
  createdAt: Date;
  overdueAt: Date | null;
  status: string;
  resolvedAt: Date | null;
}

export interface TmReopen {
  taskId: number;
  reopenedAt: Date;
  passedAt: Date | null;
  chargedUserId: number | null;
}

export interface TmStatusEvent {
  taskId: number;
  toStatus: string;
  occurredAt: Date;
  actorUserId: number | null;
}

export interface TrackingMetricsInput {
  // The night being computed (YYYY-MM-DD, team zone) and the run time.
  snapshotDate: string;
  now: Date;
  // When the project was first switched on.
  trackingSince: Date;
  windowDays: number;
  minSample: number;
  calendar: WorkingCalendar;
  thresholds: PerformanceTrackingThresholds;
  people: number[];
  tasks: TmTask[];
  rounds: TmRound[];
  commitmentEvents: TmCommitmentEvent[];
  flags: TmFlag[];
  tickets: TmTicket[];
  reopens: TmReopen[];
  chases: Array<{ taskId: number; assigneeUserId: number; createdAt: Date }>;
  notes: Array<{ taskId: number; authorUserId: number; createdAt: Date }>;
  statusEvents: TmStatusEvent[];
  // From computePerformanceMetrics (the Non-Compliance engine), per person.
  onTimeItems: Map<number, OnTimeItem[]>;
  chargedChanges: Map<number, DueChangeItem[]>;
  changeSample: Map<number, number>;
}

export interface TrackingMetricRow {
  userId: number;
  metric: TrackingMetric;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  sample: number;
  enoughData: boolean;
  details: Record<string, unknown>;
}

export interface TrackingMetricsResult {
  windowFrom: string;
  rows: TrackingMetricRow[];
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 10000) / 100 : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Working days after `from`'s day up to and including `to`'s day (team
// zone). Same day, or `to` before `from` = 0.
export function workingDaysBetweenDays(fromDay: string, toDay: string, cal: WorkingCalendar): number {
  let days = 0;
  for (let d = addCalendarDays(fromDay, 1); d <= toDay; d = addCalendarDays(d, 1)) if (isWorkingDay(d, cal)) days += 1;
  return days;
}

export function workingDaysBetween(from: Date, to: Date, cal: WorkingCalendar): number {
  return workingDaysBetweenDays(dateInZone(from, cal.timeZone), dateInZone(to, cal.timeZone), cal);
}

export function computeTrackingMetrics(input: TrackingMetricsInput): TrackingMetricsResult {
  const { calendar: cal, thresholds: th, snapshotDate } = input;
  const zone = cal.timeZone;
  const sinceDay = dateInZone(input.trackingSince, zone);
  const rollingFrom = addCalendarDays(snapshotDate, -(input.windowDays - 1));
  const windowFrom = rollingFrom > sinceDay ? rollingFrom : sinceDay;
  const fromAt = new Date(Math.max(startOfDayInZone(windowFrom, zone).getTime(), input.trackingSince.getTime()));
  const toAt = startOfDayInZone(addCalendarDays(snapshotDate, 1), zone);
  // Open-ended things (a blocker still open) run to the end of the
  // snapshot day, or now if that is earlier (a same-day recalculation).
  const endAt = new Date(Math.min(toAt.getTime(), input.now.getTime()));
  const inWindow = (t: Date | null | undefined) => !!t && t.getTime() >= fromAt.getTime() && t.getTime() < toAt.getTime();
  const day = (t: Date) => dateInZone(t, zone);

  const tasks = new Map(input.tasks.filter((t) => t.status !== 'Junk').map((t) => [t.id, t]));
  const people = new Set(input.people);
  const rows: TrackingMetricRow[] = [];
  const push = (
    userId: number,
    metric: TrackingMetric,
    value: number | null,
    sample: number,
    numerator: number | null,
    denominator: number | null,
    details: Record<string, unknown>,
    // Counts that mean something even when small (O5) always have enough.
    alwaysEnough = false,
  ) =>
    rows.push({
      userId,
      metric,
      value: value === null ? null : round2(value),
      numerator,
      denominator,
      sample,
      enoughData: value !== null && (alwaysEnough || sample >= input.minSample),
      details,
    });

  const byTask = <T extends { taskId: number }>(items: T[]) => {
    const m = new Map<number, T[]>();
    for (const i of items) {
      if (!tasks.has(i.taskId)) continue;
      if (!m.has(i.taskId)) m.set(i.taskId, []);
      m.get(i.taskId)!.push(i);
    }
    for (const list of m.values()) list.sort((a: any, b: any) => (a.occurredAt ?? a.submittedAt ?? a.setAt ?? a.createdAt) - (b.occurredAt ?? b.submittedAt ?? b.setAt ?? b.createdAt));
    return m;
  };
  const eventsByTask = byTask(input.commitmentEvents);
  const roundsByTask = byTask(input.rounds);
  const flagsByTask = byTask(input.flags);
  const statusByTask = byTask(input.statusEvents);
  const notesByTask = byTask(input.notes);

  // The Due date in force at `at`: the last date event before it, else
  // the task's current date.
  const dueAt = (task: TmTask, at: Date): string | null => {
    let due: string | null | undefined;
    for (const e of eventsByTask.get(task.id) ?? []) {
      if (e.occurredAt.getTime() > at.getTime()) break;
      if (['due_set', 'due_changed', 'due_committed'].includes(e.kind)) due = e.newDueDate;
      else if (e.kind === 'due_cleared') due = null;
    }
    return due === undefined ? task.dueDate : due;
  };
  // Who held the task at `at` (assignment events; else its current assignee).
  const assigneeAt = (task: TmTask, at: Date): number | null => {
    let who: number | null | undefined;
    for (const e of eventsByTask.get(task.id) ?? []) {
      if (e.occurredAt.getTime() > at.getTime()) break;
      if (e.kind === 'assigned' || e.kind === 'unassigned') who = e.assigneeUserId;
    }
    return who === undefined ? task.assigneeUserId : who;
  };
  const statusAt = (taskId: number, at: Date): string | null => {
    let status: string | null = null;
    for (const e of statusByTask.get(taskId) ?? []) {
      if (e.occurredAt.getTime() > at.getTime()) break;
      status = e.toStatus;
    }
    return status;
  };

  // ---- D1 (+ slippage for D4, slipped tasks for D3) ----
  type Delivery = { taskId: number; userId: number; submittedAt: Date; due: string | null; onTime: boolean; daysLate: number };
  const deliveries: Delivery[] = [];
  for (const [taskId, rounds] of roundsByTask) {
    const task = tasks.get(taskId)!;
    for (const r of rounds) {
      if (r.reviewType !== 'qa' || r.status !== 'approved' || !inWindow(r.reviewedAt)) continue;
      const due = dueAt(task, r.submittedAt);
      const submittedDay = day(r.submittedAt);
      const onTime = due !== null && submittedDay <= due;
      deliveries.push({ taskId, userId: r.submittedByUserId, submittedAt: r.submittedAt, due, onTime, daysLate: due && !onTime ? workingDaysBetweenDays(due, submittedDay, cal) : 0 });
    }
  }
  const externallyBlocked = (d: Delivery) => (flagsByTask.get(d.taskId) ?? []).some((f) => f.kind === 'blocker' && f.external && f.setAt.getTime() <= d.submittedAt.getTime());
  const passesBy = new Map<number, Delivery[]>();
  for (const d of deliveries) {
    if (!passesBy.has(d.userId)) passesBy.set(d.userId, []);
    passesBy.get(d.userId)!.push(d);
  }

  // ---- Q1 / Q2: each task's first verdict ----
  const firstVerdict = (rounds: TmRound[], countNotReady: boolean) => {
    for (const r of rounds) {
      if (r.reviewType !== 'qa') continue;
      if (r.status === 'not_ready') {
        if (!countNotReady) continue;
        if (r.dependencyExempt && th.notReadyDeclaredDependencyExempt) continue;
        return r;
      }
      if (r.status === 'approved' || r.status === 'rejected') return r;
    }
    return null;
  };
  const firstVerdicts = (countNotReady: boolean) => {
    const by = new Map<number, TmRound[]>();
    for (const rounds of roundsByTask.values()) {
      const v = firstVerdict(rounds, countNotReady);
      if (!v || !inWindow(v.reviewedAt)) continue;
      if (!by.has(v.submittedByUserId)) by.set(v.submittedByUserId, []);
      by.get(v.submittedByUserId)!.push(v);
    }
    return by;
  };
  const q1By = firstVerdicts(true);
  const q2By = firstVerdicts(false);

  // ---- L1 / L2: first submission (QA or Peer Review) ----
  const firstSubmitBy = new Map<number, TmTask[]>();
  for (const [taskId, rounds] of roundsByTask) {
    const first = rounds.find((r) => (r.reviewType === 'qa' || r.reviewType === 'peer') && r.status !== 'withdrawn');
    if (!first || !inWindow(first.submittedAt)) continue;
    if (!firstSubmitBy.has(first.submittedByUserId)) firstSubmitBy.set(first.submittedByUserId, []);
    firstSubmitBy.get(first.submittedByUserId)!.push(tasks.get(taskId)!);
  }

  // ---- C5: working days in the window ----
  const sampleDays: string[] = [];
  for (let d = windowFrom; d <= snapshotDate; d = addCalendarDays(d, 1)) if (isWorkingDay(d, cal)) sampleDays.push(d);

  // One pass over tasks x working days for everyone: who held each active
  // task at the end of each day, and whether it was fresh for them.
  const freshness = new Map<number, { samples: number; fresh: number; stale: Set<number> }>();
  for (const task of tasks.values()) {
    const statusEvents = statusByTask.get(task.id) ?? [];
    if (statusEvents.length === 0) continue;
    const notes = notesByTask.get(task.id) ?? [];
    const assignments = (eventsByTask.get(task.id) ?? []).filter((e) => e.kind === 'assigned');
    for (const d of sampleDays) {
      const dayEnd = new Date(Math.min(startOfDayInZone(addCalendarDays(d, 1), zone).getTime() - 1, endAt.getTime()));
      if (dayEnd.getTime() < fromAt.getTime()) continue;
      const status = statusAt(task.id, dayEnd);
      if (!status || !FRESHNESS_ACTIVE_STATUSES.includes(status)) continue;
      const userId = assigneeAt(task, dayEnd);
      if (userId === null || !people.has(userId)) continue;
      // The latest moment the task was touched for this person.
      let last = 0;
      const touch = (t: Date) => {
        if (t.getTime() <= dayEnd.getTime() && t.getTime() > last) last = t.getTime();
      };
      for (const e of statusEvents) if (e.actorUserId === userId || FRESHNESS_ACTIVE_STATUSES.includes(e.toStatus)) touch(e.occurredAt);
      for (const n of notes) if (n.authorUserId === userId) touch(n.createdAt);
      for (const e of assignments) if (e.assigneeUserId === userId) touch(e.occurredAt);
      if (!freshness.has(userId)) freshness.set(userId, { samples: 0, fresh: 0, stale: new Set() });
      const f = freshness.get(userId)!;
      f.samples += 1;
      if (last && workingDaysBetweenDays(day(new Date(last)), d, cal) <= th.statusFreshWorkingDays) f.fresh += 1;
      else f.stale.add(task.id);
    }
  }

  for (const userId of people) {
    // D1
    const passes = (passesBy.get(userId) ?? []).filter((d) => !externallyBlocked(d));
    const onTime = passes.filter((d) => d.onTime).length;
    push(userId, 'D1', pct(onTime, passes.length), passes.length, onTime, passes.length, {
      late: passes.filter((d) => !d.onTime).map((d) => ({ taskId: d.taskId, due: d.due, submitted: day(d.submittedAt), workingDaysLate: d.daysLate })),
      leftOutExternal: (passesBy.get(userId) ?? []).filter(externallyBlocked).map((d) => d.taskId),
    });

    // D2
    const coverage = (input.onTimeItems.get(userId) ?? []).filter((i) => tasks.has(i.taskId) && inWindow(i.assignedAt));
    const covered = coverage.filter((i) => i.outcome === 'on_time' || i.outcome === 'already_dated').length;
    push(userId, 'D2', pct(covered, coverage.length), coverage.length, covered, coverage.length, {
      missed: coverage.filter((i) => !(i.outcome === 'on_time' || i.outcome === 'already_dated')).map((i) => ({ taskId: i.taskId, outcome: i.outcome, dueBy: i.dueBy })),
    });

    // D4
    const changes = (input.chargedChanges.get(userId) ?? []).filter((c) => tasks.has(c.taskId) && inWindow(c.at));
    const movesPerTask = new Map<number, number>();
    for (const c of changes) movesPerTask.set(c.taskId, (movesPerTask.get(c.taskId) ?? 0) + 1);
    const lateDeliveries = passes.filter((d) => !d.onTime);
    push(userId, 'D4', changes.length, input.changeSample.get(userId) ?? 0, changes.length, null, {
      later: changes.filter((c) => c.direction === 'later').length,
      earlier: changes.filter((c) => c.direction === 'earlier').length,
      tasksMovedTooOften: [...movesPerTask].filter(([, n]) => n >= th.dateMovesFlagCount).map(([taskId, n]) => ({ taskId, moves: n })),
      lateDeliveries: lateDeliveries.length,
      slippageWorkingDays: lateDeliveries.reduce((s, d) => s + d.daysLate, 0),
    });

    // D3: slipped = late delivery, or a later date change they started.
    const slipped = new Map<number, string | null>();
    for (const d of lateDeliveries) slipped.set(d.taskId, d.due);
    for (const c of changes) if (c.direction === 'later' && !slipped.has(c.taskId)) slipped.set(c.taskId, c.oldDueDate);
    const warned = [...slipped].filter(([taskId, due]) =>
      (flagsByTask.get(taskId) ?? []).some((f) => {
        const date = f.committedDueDateAtSet ?? due;
        return f.kind === 'risk' && f.setByAssignee && f.assigneeUserId === userId && !!date && workingDaysBetweenDays(day(f.setAt), date, cal) >= th.earlyWarningWorkingDays;
      }),
    );
    push(userId, 'D3', pct(warned.length, slipped.size), slipped.size, warned.length, slipped.size, {
      slippedTaskIds: [...slipped.keys()],
      warnedTaskIds: warned.map(([id]) => id),
    });

    // Q1 / Q2
    const q1 = q1By.get(userId) ?? [];
    const q1ok = q1.filter((r) => r.status === 'approved').length;
    push(userId, 'Q1', pct(q1ok, q1.length), q1.length, q1ok, q1.length, {
      notAccepted: q1.filter((r) => r.status !== 'approved').map((r) => ({ taskId: r.taskId, verdict: r.status })),
    });
    const q2 = q2By.get(userId) ?? [];
    const q2ok = q2.filter((r) => r.status === 'approved').length;
    push(userId, 'Q2', pct(q2ok, q2.length), q2.length, q2ok, q2.length, {
      failed: q2.filter((r) => r.status !== 'approved').map((r) => r.taskId),
    });

    // Q3
    const allPasses = passesBy.get(userId) ?? [];
    const reopens = input.reopens.filter(
      (r) =>
        tasks.has(r.taskId) &&
        r.chargedUserId === userId &&
        inWindow(r.reopenedAt) &&
        (!r.passedAt || r.reopenedAt.getTime() - r.passedAt.getTime() <= th.reopenWindowDays * DAY_MS),
    );
    push(userId, 'Q3', pct(reopens.length, allPasses.length), allPasses.length, reopens.length, allPasses.length, {
      reopenedTaskIds: reopens.map((r) => r.taskId),
    });

    // C2
    const owned = input.tickets.filter(
      (t) => tasks.has(t.parentTaskId) && t.ownerUserId === userId && t.overdueAt && t.overdueAt.getTime() < toAt.getTime() && (!t.resolvedAt || t.resolvedAt.getTime() > fromAt.getTime()),
    );
    const clip = (a: Date) => (a.getTime() < fromAt.getTime() ? fromAt : a);
    const overdue = owned.map((t) => ({
      ticketId: t.id,
      taskId: t.parentTaskId,
      overdueWorkingDays: workingDaysBetween(clip(t.overdueAt!), t.resolvedAt && t.resolvedAt.getTime() < endAt.getTime() ? t.resolvedAt : endAt, cal),
    }));
    const blockedOnThem = input.flags.filter(
      (f) => tasks.has(f.taskId) && f.kind === 'blocker' && !f.external && f.blockingOwnerUserId === userId && f.setAt.getTime() < toAt.getTime() && (!f.clearedAt || f.clearedAt.getTime() > fromAt.getTime()),
    );
    const ticketsWithDate = input.tickets.filter((t) => tasks.has(t.parentTaskId) && t.ownerUserId === userId && t.overdueAt && (t.status === 'open' || (t.resolvedAt && t.resolvedAt.getTime() > fromAt.getTime())));
    push(userId, 'C2', overdue.length, ticketsWithDate.length, overdue.length, null, {
      overdue,
      overdueWorkingDays: overdue.reduce((s, o) => s + o.overdueWorkingDays, 0),
      blockedWorkingDays: blockedOnThem.reduce((s, f) => s + workingDaysBetween(clip(f.setAt), f.clearedAt && f.clearedAt.getTime() < endAt.getTime() ? f.clearedAt : endAt, cal), 0),
    });

    // C5
    const c5 = freshness.get(userId) ?? { samples: 0, fresh: 0, stale: new Set<number>() };
    push(userId, 'C5', pct(c5.fresh, c5.samples), c5.samples, c5.fresh, c5.samples, { taskDays: c5.samples, freshTaskDays: c5.fresh, staleTaskIds: [...c5.stale] });

    // O1
    const lags: Array<{ ticketId: number | null; taskId: number; lagWorkingDays: number }> = [];
    for (const t of input.tickets) {
      const task = tasks.get(t.parentTaskId);
      if (!task) continue;
      const start = th.blockerLagClockStart === 'dependency_created' ? t.createdAt : t.overdueAt;
      if (!start || !inWindow(start) || assigneeAt(task, start) !== userId) continue;
      const flag = (flagsByTask.get(task.id) ?? []).find((f) => f.kind === 'blocker' && f.setByAssignee && f.setAt.getTime() >= t.createdAt.getTime());
      if (th.blockerLagClockStart === 'blocker_flag' && !flag) continue;
      const end = flag ? flag.setAt : t.resolvedAt && t.resolvedAt.getTime() < endAt.getTime() ? t.resolvedAt : endAt;
      lags.push({ ticketId: t.id, taskId: task.id, lagWorkingDays: end.getTime() <= start.getTime() ? 0 : workingDaysBetween(start, end, cal) });
    }
    if (th.blockerLagClockStart === 'dependency_overdue_or_blocker') {
      // A blocker raised with no dependency ticket was raised at once.
      for (const f of input.flags) {
        if (tasks.has(f.taskId) && f.kind === 'blocker' && f.setByAssignee && f.assigneeUserId === userId && f.dependencyTicketId === null && inWindow(f.setAt)) {
          lags.push({ ticketId: null, taskId: f.taskId, lagWorkingDays: 0 });
        }
      }
    }
    push(userId, 'O1', median(lags.map((l) => l.lagWorkingDays)), lags.length, null, null, { clockStart: th.blockerLagClockStart, items: lags });

    // O2
    const blocked = input.flags.filter(
      (f) => tasks.has(f.taskId) && f.kind === 'blocker' && f.assigneeUserId === userId && f.setAt.getTime() < toAt.getTime() && (!f.clearedAt || f.clearedAt.getTime() > fromAt.getTime()),
    );
    const ages = blocked.map((f) => ({ taskId: f.taskId, open: !f.clearedAt, ageWorkingDays: workingDaysBetween(f.setAt, f.clearedAt && f.clearedAt.getTime() < endAt.getTime() ? f.clearedAt : endAt, cal) }));
    push(
      userId,
      'O2',
      ages.length ? ages.reduce((s, a) => s + a.ageWorkingDays, 0) / ages.length : null,
      ages.length,
      null,
      null,
      { items: ages, maxWorkingDays: ages.length ? Math.max(...ages.map((a) => a.ageWorkingDays)) : null },
    );

    // O3
    const chases = input.chases.filter((c) => tasks.has(c.taskId) && c.assigneeUserId === userId && inWindow(c.createdAt));
    const due = [...tasks.values()].filter((t) => t.assigneeUserId === userId && t.dueDate && t.dueDate >= windowFrom && t.dueDate <= snapshotDate);
    push(userId, 'O3', due.length ? (chases.length / due.length) * th.chasesPerTasks : null, due.length, chases.length, due.length, {
      perTasks: th.chasesPerTasks,
      chasedTaskIds: [...new Set(chases.map((c) => c.taskId))],
    });

    // O5
    const decided = [...tasks.values()].filter((t) => t.createdByUserId === userId && t.taskType === 'improvement' && t.improvementDecision && inWindow(t.improvementDecidedAt));
    const accepted = decided.filter((t) => t.improvementDecision === 'accepted');
    push(userId, 'O5', accepted.length, decided.length, accepted.length, decided.length, { acceptedTaskIds: accepted.map((t) => t.id), declinedTaskIds: decided.filter((t) => t.improvementDecision !== 'accepted').map((t) => t.id) }, true);

    // L1 / L2
    const submitted = (firstSubmitBy.get(userId) ?? []).filter((t) => !t.isDefect);
    const features = submitted.filter((t) => t.taskType === 'feature');
    const traced = features.filter((t) => (t.requirementId || '').trim().length > 0);
    push(userId, 'L1', pct(traced.length, features.length), features.length, traced.length, features.length, {
      missingTaskIds: features.filter((t) => !traced.includes(t)).map((t) => t.id),
    });
    const impactTasks = submitted.filter((t) => t.taskType === 'feature' || t.taskType === 'improvement');
    const withImpact = impactTasks.filter((t) => (t.clientImpact || '').trim().length >= CLIENT_IMPACT_MIN);
    push(userId, 'L2', pct(withImpact.length, impactTasks.length), impactTasks.length, withImpact.length, impactTasks.length, {
      missingTaskIds: impactTasks.filter((t) => !withImpact.includes(t)).map((t) => t.id),
    });
  }
  return { windowFrom, rows };
}
