// Daily Scrum - the single place every list and number on the page comes
// from. Pure (no Nest/TypeORM imports) so it can be tested directly. The
// person summaries, the Team tab's "Needs your attention" list and the
// "Totals match" check all read this function's output, so they cannot
// disagree.
//
// Rules (confirmed with the user 2026-10-12):
// - Active ticket: assigned to the person and not Pass, Junk, Hold, Closed
//   or Released - No Showstoppers. There are no Epic/Story containers in
//   this app, so every ticket is a real work item.
// - Each active ticket lands in exactly one group:
//   1. With reviewers - in QA or Peer Review (Feedback, Re-Feedback, Peer
//      Review, Re-Peer-Review). Stays here even when overdue; its reasons
//      still show as chips.
//   2. Blockers - any other ticket with at least one reason.
//   3. Today - everything else.
// - Reasons: sent back (Failed / Released - With Showstoppers), an open
//   defect blocking it, an open dependency it's waiting on, intervention
//   (Escalated), overdue (due date before today in the team time zone).
// - Open dependencies are listed under the person who owns them ("Others
//   are waiting on you"), never counted in that person's own work. Peer
//   reviews to do are a separate reference list for the reviewer.

export const EXCLUDED_STATUSES = ['Pass', 'Junk', 'Hold', 'Closed', 'Released - No Showstoppers'];
// 'Pending PM Review' (PM review gate, 2026-10-13) is with a reviewer too.
// 'Returned to QA': a PM sent it back to QA - with QA, not the developer.
export const REVIEW_STATUSES = ['Pending PM Review', 'Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review', 'Returned to QA'];
// 'PM Feedback': the PM sent it back for the developer to refine.
// 'Not Ready for Testing' (2026-10-27): QA could not start testing it.
export const SENT_BACK_STATUSES = ['Failed', 'Released - With Showstoppers', 'PM Feedback', 'Not Ready for Testing'];
// A dependency whose parent ticket is one of these isn't shown at all.
export const DEPENDENCY_HIDDEN_PARENT_STATUSES = ['Junk', 'Hold', 'Closed'];

export type BlockerReason = 'sent_back' | 'blocking_defect' | 'waiting_on_dependency' | 'intervention' | 'overdue';
export const REASON_ORDER: BlockerReason[] = ['sent_back', 'blocking_defect', 'waiting_on_dependency', 'intervention', 'overdue'];

export type ScrumGroup = 'today' | 'blockers' | 'withReviewers';

export interface ScrumPersonInput {
  userId: number;
  name: string;
  role: string;
}

export interface ScrumTaskInput {
  id: number;
  title: string;
  status: string;
  assigneeUserId: number;
  dueDate: string | null;
  isDefect: boolean;
  priority: string | null;
  projectName: string;
  moduleName: string;
}

export interface ScrumDependencyInput {
  id: number;
  title: string;
  parentTaskId: number;
  parentTaskTitle: string;
  parentTaskStatus: string;
  parentTaskDueDate: string | null;
  parentAssigneeUserId: number | null;
  ownerUserId: number;
  createdByUserId: number;
  createdAt: Date;
}

export interface ScrumPeerReviewInput {
  taskId: number;
  title: string;
  taskStatus: string;
  assigneeUserId: number | null;
  reviewerUserId: number;
  roundNumber: number;
  submittedAt: Date;
}

export interface ScrumEventInput {
  userId: number;
  at: Date;
  kind: string;
  taskId: number | null;
  title: string;
  detail?: string | null;
}

export interface ScrumQaInput {
  executions: { passed: number; failed: number; blocked: number; total: number };
  queue: { pendingQa: number; resubmissions: number; myOpenDefects: number };
}

export interface ComputeScrumInput {
  people: ScrumPersonInput[];
  tasks: ScrumTaskInput[];
  blockedTaskIds: number[];
  openDependencies: ScrumDependencyInput[];
  pendingPeerReviews: ScrumPeerReviewInput[];
  events: ScrumEventInput[];
  qaByUserId: Map<number, ScrumQaInput>;
  userNames: Map<number, string>;
  today: string;
}

export interface ScrumItem {
  taskId: number;
  title: string;
  status: string;
  isDefect: boolean;
  dueDate: string | null;
  priority: string | null;
  projectName: string;
  moduleName: string;
  reasons: BlockerReason[];
}

export interface ScrumPerson {
  userId: number;
  name: string;
  role: string;
  since: Array<Omit<ScrumEventInput, 'userId'>>;
  today: ScrumItem[];
  blockers: ScrumItem[];
  withReviewers: ScrumItem[];
  waitingOnYou: Array<{
    dependencyId: number;
    title: string;
    parentTaskId: number;
    parentTaskTitle: string;
    parentTaskDueDate: string | null;
    requestedByUserId: number;
    requestedByName: string;
    createdAt: Date;
  }>;
  peerReviewsToDo: Array<{ taskId: number; title: string; assigneeName: string; roundNumber: number; submittedAt: Date }>;
  counts: { today: number; blockers: number; withReviewers: number; active: number };
  qa: ScrumQaInput | null;
}

export interface ScrumTeam {
  people: ScrumPerson[];
  // Every blocker once, under its assignee.
  needsAttention: Array<ScrumItem & { userId: number; name: string }>;
  totals: { today: number; blockers: number; withReviewers: number; active: number };
  // Active tickets counted straight from the input, independently of the
  // per-person grouping - "Totals match" means both agree.
  activeTicketCount: number;
  totalsMatch: boolean;
}

export function isActiveStatus(status: string): boolean {
  return !EXCLUDED_STATUSES.includes(status);
}

export function reasonsFor(task: ScrumTaskInput, blocked: Set<number>, waiting: Set<number>, today: string): BlockerReason[] {
  const reasons = new Set<BlockerReason>();
  if (SENT_BACK_STATUSES.includes(task.status)) reasons.add('sent_back');
  if (blocked.has(task.id)) reasons.add('blocking_defect');
  if (waiting.has(task.id)) reasons.add('waiting_on_dependency');
  if (task.status === 'Escalated') reasons.add('intervention');
  // dueDate is the effective one (+ PM wait, see the service); never
  // overdue while waiting for a PM.
  if (task.status !== 'Pending PM Review' && task.dueDate && task.dueDate < today) reasons.add('overdue');
  return REASON_ORDER.filter((r) => reasons.has(r));
}

export function groupFor(status: string, reasons: BlockerReason[]): ScrumGroup {
  if (REVIEW_STATUSES.includes(status)) return 'withReviewers';
  return reasons.length > 0 ? 'blockers' : 'today';
}

// Soonest due first (no due date last), then id.
function byDue(a: { dueDate: string | null; taskId: number }, b: { dueDate: string | null; taskId: number }): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.taskId - b.taskId;
}

export function computeDailyScrum(input: ComputeScrumInput): ScrumTeam {
  const blocked = new Set(input.blockedTaskIds);
  const visibleDependencies = input.openDependencies.filter((d) => !DEPENDENCY_HIDDEN_PARENT_STATUSES.includes(d.parentTaskStatus));
  const waiting = new Set(visibleDependencies.map((d) => d.parentTaskId));
  const nameOf = (id: number | null) => (id == null ? '—' : input.userNames.get(id) || `#${id}`);

  // De-duplicated by id, active only, and only for people on the page.
  const personIds = new Set(input.people.map((p) => p.userId));
  const seen = new Set<number>();
  const activeTasks = input.tasks.filter((t) => {
    if (seen.has(t.id) || !isActiveStatus(t.status) || !personIds.has(t.assigneeUserId)) return false;
    seen.add(t.id);
    return true;
  });

  const people: ScrumPerson[] = input.people.map((p) => {
    const person: ScrumPerson = {
      userId: p.userId,
      name: p.name,
      role: p.role,
      since: input.events
        .filter((e) => e.userId === p.userId)
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .map(({ userId, ...rest }) => rest),
      today: [],
      blockers: [],
      withReviewers: [],
      waitingOnYou: visibleDependencies
        .filter((d) => d.ownerUserId === p.userId)
        .map((d) => ({
          dependencyId: d.id,
          title: d.title,
          parentTaskId: d.parentTaskId,
          parentTaskTitle: d.parentTaskTitle,
          parentTaskDueDate: d.parentTaskDueDate,
          requestedByUserId: d.createdByUserId,
          requestedByName: nameOf(d.createdByUserId),
          createdAt: d.createdAt,
        }))
        .sort((a, b) => byDue({ dueDate: a.parentTaskDueDate, taskId: a.dependencyId }, { dueDate: b.parentTaskDueDate, taskId: b.dependencyId })),
      peerReviewsToDo: input.pendingPeerReviews
        .filter((r) => r.reviewerUserId === p.userId && !DEPENDENCY_HIDDEN_PARENT_STATUSES.includes(r.taskStatus))
        .map((r) => ({ taskId: r.taskId, title: r.title, assigneeName: nameOf(r.assigneeUserId), roundNumber: r.roundNumber, submittedAt: r.submittedAt }))
        .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime()),
      counts: { today: 0, blockers: 0, withReviewers: 0, active: 0 },
      qa: input.qaByUserId.get(p.userId) || null,
    };
    for (const t of activeTasks.filter((t) => t.assigneeUserId === p.userId)) {
      const reasons = reasonsFor(t, blocked, waiting, input.today);
      const item: ScrumItem = {
        taskId: t.id,
        title: t.title,
        status: t.status,
        isDefect: t.isDefect,
        dueDate: t.dueDate,
        priority: t.priority,
        projectName: t.projectName,
        moduleName: t.moduleName,
        reasons,
      };
      person[groupFor(t.status, reasons)].push(item);
    }
    person.today.sort(byDue);
    person.blockers.sort(byDue);
    person.withReviewers.sort(byDue);
    person.counts = {
      today: person.today.length,
      blockers: person.blockers.length,
      withReviewers: person.withReviewers.length,
      active: person.today.length + person.blockers.length + person.withReviewers.length,
    };
    return person;
  });

  const totals = { today: 0, blockers: 0, withReviewers: 0, active: 0 };
  for (const p of people) for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += p.counts[k];

  const needsAttention = people
    .flatMap((p) => p.blockers.map((b) => ({ ...b, userId: p.userId, name: p.name })))
    .sort((a, b) => b.reasons.length - a.reasons.length || byDue(a, b));

  return {
    people,
    needsAttention,
    totals,
    activeTicketCount: activeTasks.length,
    totalsMatch: totals.active === activeTasks.length && totals.today + totals.blockers + totals.withReviewers === totals.active,
  };
}
