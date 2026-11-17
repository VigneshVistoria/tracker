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

const isShowstopper = (task) => task.status === 'Released - With Showstoppers' || /showstopper/i.test(task.severity || '');

// Inputs (all from existing endpoints, plus GET /design-handovers/mine):
//   tasks          GET /tasks/mine (Junk already left out)
//   ownedTickets   GET /task-dependency-tickets/mine (others wait on me)
//   inboundTickets GET /task-dependency-tickets/created-by-me (I wait on others)
//   peerReviews    GET /tasks/peer-review-queue
//   handovers      GET /design-handovers/mine
//   trackingProjects  Set of projectIds with Performance Tracking on
//   reasons        Map taskId -> fixReason() text
export function buildMyWork({
  tasks = [], ownedTickets = [], inboundTickets = [], peerReviews = [], handovers = [],
  trackingProjects = new Set(), reasons = new Map(), userId, today,
}) {
  const working = [];
  const submitted = [];
  const passedSince = new Date(dayNumber(today) * DAY_MS - PASSED_VISIBLE_DAYS * DAY_MS);

  const blockersByTask = new Map();
  for (const t of inboundTickets) {
    if (t.status !== 'open') continue;
    if (!blockersByTask.has(t.parentTaskId)) blockersByTask.set(t.parentTaskId, []);
    blockersByTask.get(t.parentTaskId).push(`Blocked: waiting on ${t.ownerName || t.ownerEmail || 'someone'} (${t.title})`);
  }

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
    };
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
      });
    }
  }

  for (const t of ownedTickets) {
    if (t.status !== 'open') continue;
    working.push({
      key: `dep-${t.id}`,
      kind: 'action',
      href: `/tasks/${t.parentTaskId}#dependency-${t.id}`,
      title: t.title,
      ref: `Dependency #${t.id}`,
      projectId: null,
      projectName: t.parentTaskProjectName ?? null,
      status: 'Someone is waiting on you',
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
