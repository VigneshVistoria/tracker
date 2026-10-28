// Performance metrics (2026-10-27, rules agreed with the user; the
// Programme Director's specification may change the numbers, which is why
// every rule below reads from PerformanceSettings, never a constant):
//
// 1. Due date set on time - each time a task is assigned to someone, the
//    Due date must be set by the end of the next working day (settings:
//    dueDateWorkingDays, timeZone, weekendDays, holidays). Reassignment
//    starts a new clock for the new assignee. A task already dated when
//    assigned counts as on time (alreadyDatedCountsOnTime); a date set by a
//    PM counts for the assignee (othersSettingDateCountsOnTime). A clock
//    that is still running, or that stopped because the task moved to
//    someone else before its deadline, isn't counted. Counted when its
//    deadline day falls in the window.
// 2. Due date changes - every change after the first commitment, made in
//    the window, counted against whoever was assignee at the time. Setting
//    it the first time isn't a change; clearing it isn't either, but
//    setting it again afterwards is one change from the last committed
//    date. Later (extensions) and earlier are counted separately. Per task
//    = changes / the person's tasks that had a committed date and were open
//    at some point in the window while they were assignee.
// 3. QA acceptance - per submission (a reverted decision and the round
//    that replaced it are the same submission: same task, submitter and
//    submit time), by its standing decision, in the window by decision
//    time. Accepted / decided and rejected / decided, plus the same for
//    each task's first submission only. PM review rounds, withdrawn rounds
//    (PM pulled back / sent back) and reverted decisions are never QA
//    rejections. Peer Review and escalated rounds per settings. A round QA
//    returned as "Not ready for testing" is never a decision either, and
//    doesn't stop the resubmission from being the first submission.
//
// Status per person over the window: OK or Needs attention per measure,
// "not enough data" below minSample; overall Needs attention if any
// measure is. Pure - no Nest/TypeORM imports - so it can be tested with a
// fixed "now".
import { CommitmentEventKind } from './task-commitment-event.entity';
import { WorkingCalendar, addCalendarDays, commitmentDeadline } from './working-days';
import { dateInZone, startOfDayInZone } from '../team-settings/time-zone';

export interface PerformanceSettings {
  timeZone: string;
  dueDateWorkingDays: number;
  weekendDays: number[];
  windowDays: number;
  minSample: number;
  onTimeOkPercent: number;
  changesOkPerTask: number;
  qaAcceptanceOkPercent: number;
  excludedStatuses: string[];
  includePeerReview: boolean;
  countEscalatedAsDecided: boolean;
  alreadyDatedCountsOnTime: boolean;
  othersSettingDateCountsOnTime: boolean;
  // Non-Compliance Report "Flagged" thresholds - used by
  // NonComplianceReportService, kept here so all rules live in one place.
  lateToQaFlagCount: number;
  rejectionRateFlagPercent: number;
  rejectionRateMinSubmissions: number;
  escalationFlagCount: number;
  vagueNotesFlagCount: number;
}

export const PERFORMANCE_SETTINGS_DEFAULTS: PerformanceSettings = {
  timeZone: 'Africa/Addis_Ababa',
  dueDateWorkingDays: 1,
  weekendDays: [0, 6],
  windowDays: 28,
  minSample: 5,
  onTimeOkPercent: 90,
  changesOkPerTask: 0.5,
  qaAcceptanceOkPercent: 75,
  excludedStatuses: ['Junk', 'Hold'],
  includePeerReview: false,
  countEscalatedAsDecided: false,
  alreadyDatedCountsOnTime: true,
  othersSettingDateCountsOnTime: true,
  lateToQaFlagCount: 3,
  rejectionRateFlagPercent: 20,
  rejectionRateMinSubmissions: 3,
  escalationFlagCount: 1,
  vagueNotesFlagCount: 3,
};

export type MetricStatus = 'ok' | 'needs_attention' | 'not_enough_data';

export interface MetricPerson {
  id: number;
  fullName: string | null;
  email: string;
  role: string;
}

export interface MetricTask {
  id: number;
  title: string;
  status: string;
  createdAt: Date;
  assigneeUserId: number | null;
  dueDate: string | null;
  completedAt: Date | null;
}

export interface MetricEvent {
  taskId: number;
  kind: CommitmentEventKind;
  assigneeUserId: number | null;
  actorUserId: number | null;
  occurredAt: Date;
  newDueDate: string | null;
  source: 'live' | 'reconstructed';
  auditLogId: number;
  // Due date changes (2026-10-28): who STARTED the change. For an approved
  // Performance Tracking request it is the requester (actorUserId is the
  // approver); otherwise the actor. Undefined = use actorUserId.
  initiatorUserId?: number | null;
  // The new assignee's one free set/confirmation after a reassignment
  // (Performance Tracking S2) - their first commitment, not a change.
  freeCommitment?: boolean;
}

export interface MetricRound {
  taskId: number;
  roundNumber: number;
  submittedByUserId: number;
  submittedAt: Date;
  status: string;
  reviewType: string;
  reviewedAt: Date | null;
  revertedDecision: string | null;
}

export type OnTimeOutcome = 'on_time' | 'already_dated' | 'late' | 'not_set' | 'set_by_other';

export interface OnTimeItem {
  taskId: number;
  title: string;
  assignedAt: Date;
  dueBy: string;
  setAt: Date | null;
  setByUserId: number | null;
  outcome: OnTimeOutcome;
  reconstructed: boolean;
}

export interface DueChangeItem {
  taskId: number;
  title: string;
  at: Date;
  byUserId: number | null;
  // Who started it (see MetricEvent.initiatorUserId).
  initiatedByUserId: number | null;
  oldDueDate: string;
  newDueDate: string;
  direction: 'later' | 'earlier';
  reconstructed: boolean;
}

export interface QaSubmissionItem {
  taskId: number;
  title: string;
  submittedAt: Date;
  decidedAt: Date;
  decision: 'approved' | 'rejected' | 'escalated';
  // The decision first given, if a PM later reverted it.
  revertedFrom: string | null;
  isFirstSubmission: boolean;
  reviewType: string;
}

export interface QaRates {
  decided: number;
  accepted: number;
  rejected: number;
  acceptedPercent: number | null;
  rejectedPercent: number | null;
}

export interface PersonMetrics {
  userId: number;
  fullName: string | null;
  email: string;
  role: string;
  status: MetricStatus;
  onTime: { counted: number; onTime: number; late: number; percent: number | null; status: MetricStatus; items: OnTimeItem[] };
  dueChanges: {
    tasks: number;
    changes: number;
    later: number;
    earlier: number;
    perTask: number | null;
    status: MetricStatus;
    items: DueChangeItem[];
    // Changes someone else (a PM/Admin) started on this person's tasks -
    // shown, never charged.
    notCharged: { changes: number; items: DueChangeItem[] };
    // The tasks the per-task average is taken over.
    tasksCounted: Array<{ taskId: number; title: string }>;
  };
  qa: QaRates & { status: MetricStatus; firstSubmission: QaRates; items: QaSubmissionItem[] };
}

export interface MetricsInput {
  now: Date;
  // Last day of the window (YYYY-MM-DD in settings.timeZone).
  to: string;
  settings: PerformanceSettings;
  holidays: string[];
  people: MetricPerson[];
  tasks: MetricTask[];
  events: MetricEvent[];
  rounds: MetricRound[];
}

export interface MetricsResult {
  window: { from: string; to: string; days: number; timeZone: string };
  people: PersonMetrics[];
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function statusFor(sample: number, minSample: number, value: number | null, ok: (v: number) => boolean): MetricStatus {
  if (value === null || sample < minSample) return 'not_enough_data';
  return ok(value) ? 'ok' : 'needs_attention';
}

export function overallStatus(statuses: MetricStatus[]): MetricStatus {
  if (statuses.includes('needs_attention')) return 'needs_attention';
  if (statuses.includes('ok')) return 'ok';
  return 'not_enough_data';
}

// The last day of the window and its first, in the team's zone.
export function metricsWindow(now: Date, to: string | undefined, settings: PerformanceSettings): { from: string; to: string } {
  const end = to ?? dateInZone(now, settings.timeZone);
  return { from: addCalendarDays(end, -(settings.windowDays - 1)), to: end };
}

interface Spell {
  userId: number;
  start: Date;
  end: Date | null;
  reconstructed: boolean;
}

const t = (d: Date) => d.getTime();

export function computePerformanceMetrics(input: MetricsInput): MetricsResult {
  const { settings, now } = input;
  const window = metricsWindow(now, input.to, settings);
  const windowStart = startOfDayInZone(window.from, settings.timeZone);
  const windowEnd = startOfDayInZone(addCalendarDays(window.to, 1), settings.timeZone);
  const cal: WorkingCalendar = { timeZone: settings.timeZone, weekendDays: settings.weekendDays, holidays: new Set(input.holidays) };

  const personIds = new Set(input.people.map((p) => p.id));
  const onTimeBy = new Map<number, OnTimeItem[]>();
  const changesBy = new Map<number, DueChangeItem[]>();
  const notChargedBy = new Map<number, DueChangeItem[]>();
  const changeTasksBy = new Map<number, Map<number, string>>();
  const push = <T>(map: Map<number, T[]>, key: number, item: T) => {
    if (!personIds.has(key)) return;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  };
  const addTask = (userId: number, task: MetricTask) => {
    if (!personIds.has(userId)) return;
    const counted = changeTasksBy.get(userId) ?? new Map<number, string>();
    counted.set(task.id, task.title);
    changeTasksBy.set(userId, counted);
  };

  const eventsByTask = new Map<number, MetricEvent[]>();
  for (const e of input.events) {
    const list = eventsByTask.get(e.taskId) ?? [];
    list.push(e);
    eventsByTask.set(e.taskId, list);
  }

  for (const task of input.tasks) {
    const events = (eventsByTask.get(task.id) ?? []).sort((a, b) => t(a.occurredAt) - t(b.occurredAt) || a.auditLogId - b.auditLogId);
    const assignmentEvents = events.filter((e) => e.kind === 'assigned' || e.kind === 'unassigned');
    const dueEvents = events.filter((e) => e.kind === 'due_set' || e.kind === 'due_changed' || e.kind === 'due_cleared');

    // Who was assignee, when. A task with no recorded assignment (bulk
    // imported) is taken as assigned to its current assignee at creation.
    const spells: Spell[] = [];
    if (assignmentEvents.length === 0) {
      if (task.assigneeUserId != null) spells.push({ userId: task.assigneeUserId, start: task.createdAt, end: null, reconstructed: true });
    } else {
      assignmentEvents.forEach((e, i) => {
        if (e.kind !== 'assigned' || e.assigneeUserId == null) return;
        const next = assignmentEvents[i + 1];
        spells.push({ userId: e.assigneeUserId, start: e.occurredAt, end: next ? next.occurredAt : null, reconstructed: e.source === 'reconstructed' });
      });
    }
    const ownerAt = (at: Date): number | null => {
      let owner: number | null = null;
      for (const s of spells) if (t(s.start) <= t(at) && (s.end === null || t(at) < t(s.end))) owner = s.userId;
      return owner;
    };

    // A dated task with no recorded Due date history - when it was set is
    // unknown, so it can't be judged on time or late.
    const noDueHistory = dueEvents.length === 0 && task.dueDate != null;
    const datedBefore = (at: Date): boolean => {
      let value: string | null = null;
      for (const e of dueEvents) if (t(e.occurredAt) < t(at)) value = e.newDueDate;
      return value != null;
    };

    // --- 1. Date set on time ---
    if (!noDueHistory) {
      for (const spell of spells) {
        const { dueBy, deadline } = commitmentDeadline(spell.start, settings.dueDateWorkingDays, cal);
        if (dueBy < window.from || dueBy > window.to) continue;
        const base = { taskId: task.id, title: task.title, assignedAt: spell.start, dueBy, reconstructed: spell.reconstructed };
        if (datedBefore(spell.start) && settings.alreadyDatedCountsOnTime) {
          push(onTimeBy, spell.userId, { ...base, setAt: null, setByUserId: null, outcome: 'already_dated' });
          continue;
        }
        const set = dueEvents.find(
          (e) => e.newDueDate != null && t(e.occurredAt) >= t(spell.start) && (spell.end === null || t(e.occurredAt) < t(spell.end)),
        );
        if (set) {
          let outcome: OnTimeOutcome = t(set.occurredAt) < t(deadline) ? 'on_time' : 'late';
          if (!settings.othersSettingDateCountsOnTime && set.actorUserId !== spell.userId) outcome = 'set_by_other';
          push(onTimeBy, spell.userId, { ...base, setAt: set.occurredAt, setByUserId: set.actorUserId, outcome, reconstructed: base.reconstructed || set.source === 'reconstructed' });
        } else if (spell.end !== null && t(spell.end) < t(deadline)) {
          // Moved to someone else before the deadline - the clock stopped.
        } else if (t(now) >= t(deadline)) {
          push(onTimeBy, spell.userId, { ...base, setAt: null, setByUserId: null, outcome: 'not_set' });
        }
        // else: the deadline hasn't passed yet.
      }
    }

    // --- 2. Due date changes ---
    let lastCommitted: string | null = null;
    let firstCommitAt: Date | null = noDueHistory ? task.createdAt : null;
    for (const e of dueEvents) {
      if (e.newDueDate == null) continue;
      if (firstCommitAt === null) firstCommitAt = e.occurredAt;
      if (lastCommitted !== null && e.newDueDate !== lastCommitted && t(e.occurredAt) >= t(windowStart) && t(e.occurredAt) < t(windowEnd)) {
        const owner = e.assigneeUserId ?? ownerAt(e.occurredAt);
        // Only changes the assignee started are charged to them (2026-10-28).
        // A change whose actor wasn't recorded is still charged, as before.
        // The new assignee's free first commitment is not a change at all.
        if (owner != null && !e.freeCommitment) {
          const initiator = e.initiatorUserId !== undefined ? e.initiatorUserId : e.actorUserId;
          const item: DueChangeItem = {
            taskId: task.id,
            title: task.title,
            at: e.occurredAt,
            byUserId: e.actorUserId,
            initiatedByUserId: initiator,
            oldDueDate: lastCommitted,
            newDueDate: e.newDueDate,
            direction: e.newDueDate > lastCommitted ? 'later' : 'earlier',
            reconstructed: e.source === 'reconstructed',
          };
          push(initiator == null || initiator === owner ? changesBy : notChargedBy, owner, item);
          addTask(owner, task);
        }
      }
      lastCommitted = e.newDueDate;
    }
    const openInWindow = task.completedAt === null || t(task.completedAt) >= t(windowStart);
    if (firstCommitAt !== null && t(firstCommitAt) < t(windowEnd) && openInWindow) {
      for (const s of spells) {
        if (t(s.start) < t(windowEnd) && (s.end === null || t(s.end) > t(windowStart))) addTask(s.userId, task);
      }
    }
  }

  // --- 3. QA acceptance ---
  const taskById = new Map(input.tasks.map((x) => [x.id, x]));
  const types = settings.includePeerReview ? ['qa', 'peer'] : ['qa'];
  const submissions = new Map<string, MetricRound[]>();
  for (const r of input.rounds) {
    if (!types.includes(r.reviewType) || !taskById.has(r.taskId)) continue;
    const key = `${r.taskId}|${t(r.submittedAt)}|${r.submittedByUserId}`;
    const list = submissions.get(key) ?? [];
    list.push(r);
    submissions.set(key, list);
  }
  const firstSubmitByTask = new Map<number, number>();
  for (const rounds of submissions.values()) {
    // A submission QA returned as "Not ready for testing" (2026-10-27) was
    // never tested - the resubmission is still the first one QA judged.
    if (rounds.every((r) => r.status === 'not_ready')) continue;
    const at = t(rounds[0].submittedAt);
    const prev = firstSubmitByTask.get(rounds[0].taskId);
    if (prev === undefined || at < prev) firstSubmitByTask.set(rounds[0].taskId, at);
  }
  const qaBy = new Map<number, QaSubmissionItem[]>();
  for (const rounds of submissions.values()) {
    rounds.sort((a, b) => a.roundNumber - b.roundNumber);
    const last = rounds[rounds.length - 1];
    const decided = last.status === 'approved' || last.status === 'rejected' || (last.status === 'escalated' && settings.countEscalatedAsDecided);
    if (!decided || !last.reviewedAt) continue;
    if (t(last.reviewedAt) < t(windowStart) || t(last.reviewedAt) >= t(windowEnd)) continue;
    const reverted = rounds.find((r) => r.status === 'reverted');
    push(qaBy, last.submittedByUserId, {
      taskId: last.taskId,
      title: taskById.get(last.taskId)!.title,
      submittedAt: last.submittedAt,
      decidedAt: last.reviewedAt,
      decision: last.status as QaSubmissionItem['decision'],
      revertedFrom: reverted?.revertedDecision ?? null,
      isFirstSubmission: firstSubmitByTask.get(last.taskId) === t(last.submittedAt),
      reviewType: last.reviewType,
    });
  }
  const rates = (items: QaSubmissionItem[]): QaRates => {
    const accepted = items.filter((i) => i.decision === 'approved').length;
    const rejected = items.filter((i) => i.decision === 'rejected').length;
    return { decided: items.length, accepted, rejected, acceptedPercent: pct(accepted, items.length), rejectedPercent: pct(rejected, items.length) };
  };

  const people: PersonMetrics[] = input.people.map((p) => {
    const onTimeItems = onTimeBy.get(p.id) ?? [];
    const good = onTimeItems.filter((i) => i.outcome === 'on_time' || i.outcome === 'already_dated').length;
    const onTimePercent = pct(good, onTimeItems.length);
    const onTimeStatus = statusFor(onTimeItems.length, settings.minSample, onTimePercent, (v) => v >= settings.onTimeOkPercent);

    const changeItems = changesBy.get(p.id) ?? [];
    const notChargedItems = notChargedBy.get(p.id) ?? [];
    const changeTasks = [...(changeTasksBy.get(p.id) ?? new Map<number, string>())].map(([taskId, title]) => ({ taskId, title }));
    const perTask = changeTasks.length > 0 ? Math.round((changeItems.length / changeTasks.length) * 100) / 100 : null;
    const changesStatus = statusFor(changeTasks.length, settings.minSample, perTask, (v) => v <= settings.changesOkPerTask);

    const qaItems = qaBy.get(p.id) ?? [];
    const all = rates(qaItems);
    const qaStatus = statusFor(all.decided, settings.minSample, all.acceptedPercent, (v) => v >= settings.qaAcceptanceOkPercent);

    return {
      userId: p.id,
      fullName: p.fullName,
      email: p.email,
      role: p.role,
      status: overallStatus([onTimeStatus, changesStatus, qaStatus]),
      onTime: { counted: onTimeItems.length, onTime: good, late: onTimeItems.length - good, percent: onTimePercent, status: onTimeStatus, items: onTimeItems },
      dueChanges: {
        tasks: changeTasks.length,
        changes: changeItems.length,
        later: changeItems.filter((i) => i.direction === 'later').length,
        earlier: changeItems.filter((i) => i.direction === 'earlier').length,
        perTask,
        status: changesStatus,
        items: changeItems,
        notCharged: { changes: notChargedItems.length, items: notChargedItems },
        tasksCounted: changeTasks,
      },
      qa: { ...all, status: qaStatus, firstSubmission: rates(qaItems.filter((i) => i.isFirstSubmission)), items: qaItems },
    };
  });

  return { window: { ...window, days: settings.windowDays, timeZone: settings.timeZone }, people };
}
