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
export function buildMyWork({
  tasks = [], ownedTickets = [], inboundTickets = [], peerReviews = [], handovers = [],
  trackingProjects = new Set(), reasons = new Map(), blockerFlags = new Map(), userId, today,
}) {
  const working = [];
  const submitted = [];
  const passedSince = new Date(dayNumber(today) * DAY_MS - PASSED_VISIBLE_DAYS * DAY_MS);

  // Blocked: open dependency tickets I filed, plus open blocker flags
  // (a flag linked to one of those tickets is shown once, as the ticket).
  const blockersByTask = new Map();
  const addBlocker = (taskId, text) => {
    if (!blockersByTask.has(taskId)) blockersByTask.set(taskId, []);
    blockersByTask.get(taskId).push(text);
  };
  const openInbound = new Map(inboundTickets.filter((t) => t.status === 'open').map((t) => [t.id, t]));
  for (const t of openInbound.values()) addBlocker(t.parentTaskId, `Blocked: waiting on ${t.ownerName || t.ownerEmail || 'someone'} (${t.title})`);
  for (const [taskId, f] of blockerFlags) {
    if (f.dependencyTicketId != null && openInbound.get(f.dependencyTicketId)?.parentTaskId === taskId) continue;
    const what = (f.dependencyTicketId != null && openInbound.get(f.dependencyTicketId)?.title) || f.reason || 'blocker';
    addBlocker(taskId, `Blocked: waiting on ${f.blockingOwnerName || 'someone'} (${what.length > 80 ? `${what.slice(0, 77)}...` : what})`);
  }

  // Dependency tickets others filed on me: when the ticket has a linked
  // task assigned to me, the task row carries "<name> is waiting on you"
  // instead of a second row for the ticket.
  const ownedOpen = ownedTickets.filter((t) => t.status === 'open');
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
    const row = {
      key: `task-${task.id}`,
      kind: 'task',
      href: `/tasks/${task.id}`,
      title: task.title,
      ref: `#${task.id}`,
      projectId: task.projectId,
      projectName: task.projectName,
      status: info.label,
      fix: Boolean(info.fix),
      date,
      // Only work that is the developer's can be late (KPI rule).
      late: info.group === 'working' ? daysLate(date, today) : 0,
      reason: info.fix ? reasons.get(task.id) || null : null,
      blocked: blockersByTask.get(task.id) || [],
      showstopper: isShowstopper(task),
      waiting: null,
    };
    const waitingTickets = ticketsByLinkedTask.get(task.id) || [];
    if (waitingTickets.length) {
      row.waiting = waitingLabel(waitingTickets.map(requesterName));
      for (const t of waitingTickets) shownTicketIds.add(t.id);
    }
    (info.group === 'working' ? working : submitted).push(row);

    // Due date to confirm: one row per task - a Working row gets a
    // "Confirm due date" tag; a Submitted task gets its own Working row.
    if (trackingProjects.has(task.projectId) && needsDueDateCommit(task, userId)) {
      if (info.group === 'working') {
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

  for (const t of peerReviews) {
    working.push({
      key: `peer-${t.id}`,
      kind: 'action',
      href: `/tasks/${t.id}`,
      title: t.title,
      ref: `#${t.id}`,
      projectId: t.projectId,
      projectName: t.projectName,
      status: 'Review needed',
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

  // Working: late first (most late first), then Fix needed, then by date
  // (no date last). Submitted: by date.
  const byDate = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.key.localeCompare(b.key);
  working.sort((a, b) => (b.late > 0) - (a.late > 0) || b.late - a.late || b.fix - a.fix || byDate(a, b));
  submitted.sort(byDate);

  // Tickets carry the project name only, so compare by name.
  const projects = new Set([...working, ...submitted].map((r) => r.projectName).filter(Boolean));
  return { working, submitted, multiProject: projects.size > 1 };
}
