import { effectiveDueDate } from './developerTaskStats.js';

// Developer home "My work" (NEW_UI, 2026-11-17, spec from the user):
// one Working / Submitted toggle. The counts and the lists both come from
// buildMyWork() below, so a count is always its list's length.

// Status -> group + short status text.
const STATUS_MAP = {
  Development: { group: 'working', label: 'Working on it' },
  Failed: { group: 'working', label: 'Fix needed', fix: true },
  'Released - With Showstoppers': { group: 'working', label: 'Fix needed', fix: true },
  'PM Feedback': { group: 'working', label: 'Fix needed', fix: true },
  'Not Ready for Testing': { group: 'working', label: 'Fix needed', fix: true },
  'Peer Review': { group: 'submitted', label: 'With reviewer' },
  'Re-Peer-Review': { group: 'submitted', label: 'With reviewer' },
  Feedback: { group: 'submitted', label: 'With QA' },
  'Re-Feedback': { group: 'submitted', label: 'With QA' },
  'Returned to QA': { group: 'submitted', label: 'With QA' },
  'Pending PM Review': { group: 'submitted', label: 'Waiting for PM' },
  Disputed: { group: 'submitted', label: 'Waiting for PM' },
  Escalated: { group: 'submitted', label: 'Waiting for PM' }, // Intervention
  Hold: { group: 'submitted', label: 'On hold' },
  Pass: { group: 'submitted', label: 'Passed' },
};
export const HIDDEN_STATUSES = ['Released - No Showstoppers', 'Closed', 'Junk'];
export const FIX_NEEDED_STATUSES = Object.keys(STATUS_MAP).filter((s) => STATUS_MAP[s].fix);
export const PASSED_VISIBLE_DAYS = 14;
// Mirrors DEPENDENCY_HIDDEN_PARENT_STATUSES (backend daily-scrum.compute.ts).
export const WAITING_HIDDEN_PARENT_STATUSES = ['Hold', 'Closed', 'Junk'];

// Tracking-commitment rule, mirrors backend/src/tasks/due-date-change.ts
// (commitmentState + dueDatePermissions): the assignee must confirm a date
// they did not set themselves, only while tracking is on for the project.
const DUE_DATE_FROZEN_STATUSES = ['Pass', 'Junk', 'Hold', 'Closed', 'Released - No Showstoppers', 'Released - With Showstoppers'];
export function needsDueDateCommit(task, userId) {
  return Boolean(
    task.dueDate && task.assigneeUserId === userId && task.dueDateCommittedByUserId !== userId && !DUE_DATE_FROZEN_STATUSES.includes(task.status),
  );
}

export function statusInfo(status) {
  if (HIDDEN_STATUSES.includes(status)) return null;
  // A status added later: show it under Working with its own name, so
  // nothing silently drops off the page.
  return STATUS_MAP[status] || { group: 'working', label: status };
}

const DAY_MS = 86400000;
const dayNumber = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS;
export function daysLate(date, today) {
  if (!date || date >= today) return 0;
  return Math.round(dayNumber(today) - dayNumber(date));
}

// "2026-11-17" -> "17-11-2026"
export function formatDmy(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

// Review comments are stored as HTML.
export function plainText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Who sent a Fix needed task back, and why - from the latest decided round
// (GET /tasks/:id/qa-reviews). "QA: ...", "PM: ...", "Not ready: ...";
// a peer reviewer's rejection reads "Reviewer: ...".
export function fixReason(task, reviews = []) {
  const decided = [...reviews]
    .filter((r) => r.status !== 'pending' && r.status !== 'reverted')
    .sort((a, b) => b.roundNumber - a.roundNumber)[0];
  const join = (...parts) => parts.map(plainText).filter(Boolean).join(' - ');
  let who;
  let text = '';
  if (decided?.status === 'not_ready') {
    who = 'Not ready';
    text = join(decided.notReadyReason, decided.qaComment);
  } else if (decided && (decided.reviewType === 'pm' || decided.status === 'withdrawn')) {
    who = 'PM';
    text = join(decided.qaComment);
  } else if (decided) {
    who = decided.reviewType === 'peer' ? 'Reviewer' : 'QA';
    text = join(decided.testFailedReason, decided.qaComment);
  }
  // No round found (or it doesn't fit the status): go by the status.
  if (task.status === 'Not Ready for Testing' && who !== 'Not ready') { who = 'Not ready'; text = ''; }
  if (task.status === 'PM Feedback' && who !== 'PM') { who = 'PM'; text = ''; }
  if (!who) who = 'QA';
  return `${who}: ${text || 'no reason given'}`;
}

// "Nadia is waiting on you" / "Nadia and Ahmed are waiting on you" /
// "Nadia, Ahmed and Sara are waiting on you".
export function waitingLabel(names) {
  const list = [...new Set(names.filter(Boolean))];
  if (list.length === 0) return 'Someone is waiting on you';
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${joined} ${list.length === 1 ? 'is' : 'are'} waiting on you`;
}
// "Working on it" split (2026-11-17), display only - the status stays
// Development. entry = one row of GET /tasks/mine/assignee-activity:
// no status change or progress note by me since it was given to me ->
// "Not started"; otherwise "In progress · updated N days ago". No entry
// (the call failed) -> the plain status label.
export function workingLabel(entry, today) {
  if (!entry) return STATUS_MAP.Development.label;
  if (!entry.lastActivityAt) return 'Not started';
  const days = Math.max(0, Math.round(dayNumber(today) - dayNumber(String(entry.lastActivityAt).slice(0, 10))));
  const ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  return `In progress · updated ${ago}`;
}

// "Review Ahmed's work" (peer review I must do; author = the task's assignee).
export function reviewLabel(author) {
  return author ? `Review ${author}'s work` : 'Review needed';
}

const requesterName = (t) => t.createdByName || t.createdByEmail || null;

const isShowstopper = (task) => task.status === 'Released - With Showstoppers' || /showstopper/i.test(task.severity || '');

// Inputs (all from existing endpoints, plus GET /design-handovers/mine):
//   tasks          GET /tasks/mine (Junk already left out)
//   ownedTickets   GET /task-dependency-tickets/mine (others wait on me)
//   inboundTickets GET /task-dependency-tickets/created-by-me (I wait on others)
//   peerReviews    GET /tasks/peer-review-queue
//   handovers      GET /design-handovers/mine
//   trackingProjects  Set of projectIds with Performance Tracking on
//   reasons        Map taskId -> fixReason() text
//   blockerFlags   Map taskId -> open blocker flag (GET /task-flags?taskId=)
//   activity       Map taskId -> GET /tasks/mine/assignee-activity row
//                  (Not started / In progress, and the Submitted sort date)
export function buildMyWork({
  tasks = [], ownedTickets = [], inboundTickets = [], peerReviews = [], handovers = [],
  trackingProjects = new Set(), reasons = new Map(), blockerFlags = new Map(), activity = null, userId, today,
}) {
  const working = [];
  const submitted = [];
  const passedSince = new Date(dayNumber(today) * DAY_MS - PASSED_VISIBLE_DAYS * DAY_MS);

  // Blockers: open dependency tickets I filed, plus open blocker flags (a
  // flag linked to one of those tickets counts once, as the ticket).
  // Rules (user, 2026-11-17):
  //  * blocked by ANOTHER person -> the task moves to Submitted, labelled
  //    "Blocked: waiting on <name> (<task>)"; back to Working by itself once
  //    the ticket is resolved / the flag cleared (nothing is stored here).
  //  * blocked by MYSELF -> no "Blocked"; stays in Working, placed after the
  //    dependency I must do first, with "Do <dependency> first".
  const short = (text) => (text.length > 80 ? `${text.slice(0, 77)}...` : text);
  const blockersByTask = new Map();
  const addBlocker = (taskId, b) => {
    if (!blockersByTask.has(taskId)) blockersByTask.set(taskId, []);
    blockersByTask.get(taskId).push(b);
  };
  const ticketRowKey = (t) => {
    const linkedId = t.dependencyTask?.id ?? tasks.find((x) => x.dependencyTicketId === t.id)?.id;
    return linkedId != null ? `task-${linkedId}` : `dep-${t.id}`;
  };
  const openInbound = new Map(inboundTickets.filter((t) => t.status === 'open').map((t) => [t.id, t]));
  for (const t of openInbound.values()) {
    const self = t.ownerUserId != null && t.ownerUserId === userId;
    addBlocker(t.parentTaskId, self
      ? { self, text: `Do ${short(t.title)} first`, after: ticketRowKey(t) }
      : { self, text: `Blocked: waiting on ${t.ownerName || t.ownerEmail || 'someone'} (${short(t.title)})` });
  }
  for (const [taskId, f] of blockerFlags) {
    const ticket = f.dependencyTicketId != null ? openInbound.get(f.dependencyTicketId) : null;
    if (ticket?.parentTaskId === taskId) continue;
    const what = short(ticket?.title || f.reason || 'blocker');
    const self = f.blockingOwnerUserId != null && f.blockingOwnerUserId === userId;
    addBlocker(taskId, self
      ? { self, text: `Do ${what} first`, after: ticket ? ticketRowKey(ticket) : null }
      : { self, text: `Blocked: waiting on ${f.blockingOwnerName || 'someone'} (${what})` });
  }

  // Dependency tickets others filed on me: when the ticket has a linked
  // task assigned to me, the task row carries "<name> is waiting on you"
  // instead of a second row for the ticket.
  // Not while the requester's task is on Hold, Closed or Junk - nobody is
  // actively waiting (same rule as Daily Scrum, 2026-11-17).
  const ownedOpen = ownedTickets.filter((t) => t.status === 'open' && !WAITING_HIDDEN_PARENT_STATUSES.includes(t.parentTaskStatus));
  const ticketsByLinkedTask = new Map();
  for (const t of ownedOpen) {
    const linkedId = t.dependencyTask?.id ?? tasks.find((x) => x.dependencyTicketId === t.id)?.id;
    if (linkedId == null) continue;
    if (!ticketsByLinkedTask.has(linkedId)) ticketsByLinkedTask.set(linkedId, []);
    ticketsByLinkedTask.get(linkedId).push(t);
  }
  const shownTicketIds = new Set();

  for (const task of tasks) {
    const info = statusInfo(task.status);
    if (!info) continue;
    if (task.status === 'Pass') {
      const doneAt = task.completedAt || task.updatedAt;
      if (!doneAt || new Date(doneAt) < passedSince) continue;
    }
    const date = effectiveDueDate(task);
    const blockers = blockersByTask.get(task.id) || [];
    const others = blockers.filter((b) => !b.self).map((b) => b.text);
    const mine = blockers.filter((b) => b.self);
    // Blocked by someone else: out of my hands -> Submitted.
    const movedOut = info.group === 'working' && others.length > 0;
    const group = movedOut ? 'submitted' : info.group;
    const row = {
      key: `task-${task.id}`,
      kind: 'task',
      href: `/tasks/${task.id}`,
      title: task.title,
      ref: `#${task.id}`,
      projectId: task.projectId,
      projectName: task.projectName,
      status: movedOut ? others[0] : task.status === 'Development' && activity ? workingLabel(activity.get(task.id), today) : info.label,
      blockedStatus: movedOut,
      fix: Boolean(info.fix) && !movedOut,
      date,
      // Only work that is the developer's can be late (KPI rule).
      late: group === 'working' ? daysLate(date, today) : 0,
      reason: info.fix ? reasons.get(task.id) || null : null,
      blocked: movedOut ? others.slice(1) : others,
      doFirst: group === 'working' ? mine.map((b) => b.text) : [],
      after: group === 'working' ? mine.map((b) => b.after).filter(Boolean) : [],
      showstopper: isShowstopper(task),
      waiting: null,
      submittedAt: activity?.get(task.id)?.lastSubmittedAt || null,
    };
    const waitingTickets = ticketsByLinkedTask.get(task.id) || [];
    if (waitingTickets.length) {
      // My own ticket on myself is not "<me> is waiting on you".
      const requesters = waitingTickets.filter((t) => t.createdByUserId !== userId);
      if (requesters.length) row.waiting = waitingLabel(requesters.map(requesterName));
      for (const t of waitingTickets) shownTicketIds.add(t.id);
    }
    (group === 'working' ? working : submitted).push(row);

    // Due date to confirm: one row per task - a Working row gets a
    // "Confirm due date" tag; a Submitted task gets its own Working row.
    if (trackingProjects.has(task.projectId) && needsDueDateCommit(task, userId)) {
      if (group === 'working') {
        row.confirmDueDate = true;
        continue;
      }
      working.push({
        ...row,
        key: `commit-${task.id}`,
        kind: 'action',
        status: 'Confirm due date',
        fix: false,
        late: 0,
        reason: null,
        blocked: [],
        doFirst: [],
        after: [],
        blockedStatus: false,
        waiting: null,
      });
    }
  }

  for (const t of ownedOpen) {
    if (shownTicketIds.has(t.id)) continue;
    working.push({
      key: `dep-${t.id}`,
      kind: 'action',
      href: `/tasks/${t.parentTaskId}#dependency-${t.id}`,
      title: t.title,
      ref: `Dependency #${t.id}`,
      projectId: null,
      projectName: t.parentTaskProjectName ?? null,
      status: waitingLabel([requesterName(t)]),
      fix: false,
      date: t.needByDate || null,
      late: daysLate(t.needByDate, today),
      reason: null,
      blocked: [],
      showstopper: false,
    });
  }

  // Peer reviews assigned to me (GET /tasks/peer-review-queue lists only
  // rounds where I am the reviewer); never my own task. Date = the review
  // due date set on submission; late in red like any Working row.
  for (const t of peerReviews) {
    if (t.assigneeUserId === userId) continue;
    working.push({
      key: `peer-${t.id}`,
      kind: 'action',
      href: `/tasks/${t.id}`,
      title: t.title,
      ref: `#${t.id}`,
      projectId: t.projectId,
      projectName: t.projectName,
      status: reviewLabel(t.assigneeFullName || t.assigneeEmail || null),
      fix: false,
      date: t.qaReviewDueDate || null,
      late: daysLate(t.qaReviewDueDate, today),
      reason: null,
      blocked: [],
      showstopper: false,
    });
  }

  for (const h of handovers) {
    working.push({
      key: `handover-${h.id}`,
      kind: 'action',
      href: `/tasks/${h.taskId}#design-handover`,
      title: h.taskTitle || `Design task #${h.taskId}`,
      ref: `#${h.taskId}`,
      projectId: h.projectId,
      projectName: h.projectName,
      status: 'Accept handover',
      fix: false,
      date: null,
      late: 0,
      reason: null,
      blocked: [],
      showstopper: false,
    });
  }

  // Order (user, 2026-11-17): Working = no due date first (tasks say "Set
  // due date"), then late (most overdue first), then by due date, soonest
  // first. Submitted = by submitted date, newest first (never submitted
  // last, then by due date).
  const byDate = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.key.localeCompare(b.key);
  for (const r of working) if (r.kind === 'task' && !r.date) r.setDueDate = true;
  working.sort((a, b) => !b.date - !a.date || (b.late > 0) - (a.late > 0) || b.late - a.late || byDate(a, b));
  // Self-dependencies: a task goes right after the dependency it waits on.
  for (const row of working.filter((r) => r.after?.length)) {
    const deps = row.after.map((k) => working.findIndex((r) => r.key === k)).filter((i) => i >= 0);
    if (!deps.length) continue;
    working.splice(working.indexOf(row), 1);
    const last = Math.max(...row.after.map((k) => working.findIndex((r) => r.key === k)));
    working.splice(last + 1, 0, row);
  }
  submitted.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || '') || byDate(a, b));

  // Tickets carry the project name only, so compare by name.
  const projects = new Set([...working, ...submitted].map((r) => r.projectName).filter(Boolean));
  return { working, submitted, multiProject: projects.size > 1 };
}
