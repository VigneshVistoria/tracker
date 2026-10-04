// Status Review - the single place every number on the page comes from.
// Pure (no Nest/TypeORM imports) so it can be tested directly - see
// test/status-review.compute.test.ts. The summary strip, the By Assignee
// table, its totals row and the "All N records shown" check line all read
// this function's output, so they cannot disagree.
//
// Definitions (confirmed with the user 2026-10):
// - Work item: an assigned task in one of the four buckets below. Pass,
//   Junk, Released - No Showstoppers, Hold, Closed and unassigned
//   (backlog) tasks are not work items.
// - Dependency to clear: an open dependency ticket whose parent task is a
//   work item. Listed once, under its owner. Its parent shows a "Waiting
//   on" chip instead of a second copy.
// - Flags (overdue / blocked / due soon) apply to work items only - a
//   dependency ticket has no due date of its own.
// - "Today" is the UTC date.

export type StatusBucket = 'failed' | 'development' | 'qa' | 'intervention';

export const BUCKET_STATUSES: Record<StatusBucket, string[]> = {
  failed: ['Failed', 'Released - With Showstoppers'],
  development: ['Development'],
  qa: ['Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review'],
  intervention: ['Escalated'],
};

export const BUCKET_ORDER: StatusBucket[] = ['failed', 'development', 'qa', 'intervention'];

export const WORK_ITEM_STATUSES: string[] = BUCKET_ORDER.flatMap((b) => BUCKET_STATUSES[b]);

export const DUE_SOON_DAYS = 7;

export function bucketForStatus(status: string): StatusBucket | null {
  for (const b of BUCKET_ORDER) {
    if (BUCKET_STATUSES[b].includes(status)) return b;
  }
  return null;
}

export interface ComputeTaskInput {
  id: number;
  title: string;
  status: string;
  assigneeUserId: number | null;
  dueDate: string | null;
  isDefect: boolean;
  priority: string | null;
  projectName: string | null;
  moduleName: string | null;
}

export interface ComputeDependencyInput {
  id: number;
  title: string;
  parentTaskId: number;
  ownerUserId: number;
  createdByUserId: number | null;
  createdByEmail: string | null;
  createdAt: Date | string;
}

export interface ComputeInput {
  tasks: ComputeTaskInput[];
  openDependencies: ComputeDependencyInput[];
  // Task ids with at least one open blocking defect.
  blockedTaskIds: number[];
  // userId -> display name (Full Name, else email).
  userNames: Map<number, string>;
  // YYYY-MM-DD (UTC).
  today: string;
}

export interface WaitingOnRef {
  dependencyId: number;
  ownerUserId: number;
  ownerName: string;
  title: string;
}

export interface TaskRecord {
  key: string; // 'task-<id>' - unique across records
  kind: 'task';
  id: number;
  title: string;
  status: string;
  bucket: StatusBucket;
  assigneeUserId: number;
  assigneeName: string;
  dueDate: string | null;
  isDefect: boolean;
  priority: string | null;
  projectName: string | null;
  moduleName: string | null;
  overdue: boolean;
  blocked: boolean;
  dueSoon: boolean;
  waitingOn: WaitingOnRef[];
}

export interface DependencyRecord {
  key: string; // 'dep-<id>'
  kind: 'dependency';
  id: number;
  title: string;
  parentTaskId: number;
  parentTaskTitle: string;
  parentBucket: StatusBucket;
  parentDueDate: string | null;
  // The owner - who must clear it. Records are grouped by this.
  assigneeUserId: number;
  assigneeName: string;
  filedByName: string;
  createdAt: Date | string;
}

export type StatusReviewRecord = TaskRecord | DependencyRecord;

export interface CountRow {
  failed: number;
  development: number;
  qa: number;
  intervention: number;
  workItems: number;
  toClear: number;
  totalRecords: number;
  overdue: number;
  blocked: number;
  dueSoon: number;
  // Open dependencies on this person's work items owned by someone else.
  // Reference only - never part of workItems/toClear/totalRecords.
  waitingOn: number;
}

export interface AssigneeRow extends CountRow {
  userId: number;
  name: string;
  // Earliest due date on or after today among this person's work items.
  nextDue: string | null;
}

export interface StatusReviewSummary {
  today: string;
  summary: CountRow;
  assignees: AssigneeRow[];
  totals: CountRow;
  records: StatusReviewRecord[];
}

function emptyCounts(): CountRow {
  return {
    failed: 0, development: 0, qa: 0, intervention: 0, workItems: 0,
    toClear: 0, totalRecords: 0, overdue: 0, blocked: 0, dueSoon: 0, waitingOn: 0,
  };
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const COUNT_KEYS: (keyof CountRow)[] = [
  'failed', 'development', 'qa', 'intervention', 'workItems',
  'toClear', 'totalRecords', 'overdue', 'blocked', 'dueSoon', 'waitingOn',
];

export function computeStatusReview(input: ComputeInput): StatusReviewSummary {
  const { today } = input;
  const dueSoonUntil = addDays(today, DUE_SOON_DAYS);
  const blocked = new Set(input.blockedTaskIds);
  const nameOf = (id: number | null, fallback?: string | null) =>
    (id != null && input.userNames.get(id)) || fallback || (id != null ? `#${id}` : '—');

  // Work items - de-duplicated by id in case the caller passes a row twice.
  const taskById = new Map<number, TaskRecord>();
  for (const t of input.tasks) {
    const bucket = bucketForStatus(t.status);
    if (!bucket || t.assigneeUserId == null || taskById.has(t.id)) continue;
    taskById.set(t.id, {
      key: `task-${t.id}`,
      kind: 'task',
      id: t.id,
      title: t.title,
      status: t.status,
      bucket,
      assigneeUserId: t.assigneeUserId,
      assigneeName: nameOf(t.assigneeUserId),
      dueDate: t.dueDate,
      isDefect: t.isDefect,
      priority: t.priority,
      projectName: t.projectName,
      moduleName: t.moduleName,
      overdue: !!t.dueDate && t.dueDate < today,
      blocked: blocked.has(t.id),
      dueSoon: !!t.dueDate && t.dueDate >= today && t.dueDate <= dueSoonUntil,
      waitingOn: [],
    });
  }

  // Dependencies - only open ones on a work item, once each, under the owner.
  const depById = new Map<number, DependencyRecord>();
  for (const d of input.openDependencies) {
    const parent = taskById.get(d.parentTaskId);
    if (!parent || depById.has(d.id)) continue;
    const dep: DependencyRecord = {
      key: `dep-${d.id}`,
      kind: 'dependency',
      id: d.id,
      title: d.title,
      parentTaskId: parent.id,
      parentTaskTitle: parent.title,
      parentBucket: parent.bucket,
      parentDueDate: parent.dueDate,
      assigneeUserId: d.ownerUserId,
      assigneeName: nameOf(d.ownerUserId),
      filedByName: nameOf(d.createdByUserId, d.createdByEmail),
      createdAt: d.createdAt,
    };
    depById.set(d.id, dep);
    parent.waitingOn.push({ dependencyId: d.id, ownerUserId: d.ownerUserId, ownerName: dep.assigneeName, title: d.title });
  }

  const tasks = Array.from(taskById.values());
  const deps = Array.from(depById.values());

  const rows = new Map<number, AssigneeRow>();
  const rowFor = (userId: number, name: string) => {
    let r = rows.get(userId);
    if (!r) {
      r = { userId, name, nextDue: null, ...emptyCounts() };
      rows.set(userId, r);
    }
    return r;
  };
  const summary = emptyCounts();
  const bump = (r: CountRow, key: keyof CountRow) => {
    r[key] += 1;
  };

  for (const t of tasks) {
    const r = rowFor(t.assigneeUserId, t.assigneeName);
    for (const target of [r, summary]) {
      bump(target, t.bucket);
      bump(target, 'workItems');
      bump(target, 'totalRecords');
      if (t.overdue) bump(target, 'overdue');
      if (t.blocked) bump(target, 'blocked');
      if (t.dueSoon) bump(target, 'dueSoon');
      for (const w of t.waitingOn) if (w.ownerUserId !== t.assigneeUserId) bump(target, 'waitingOn');
    }
    if (t.dueDate && t.dueDate >= today && (!r.nextDue || t.dueDate < r.nextDue)) r.nextDue = t.dueDate;
  }
  for (const d of deps) {
    const r = rowFor(d.assigneeUserId, d.assigneeName);
    for (const target of [r, summary]) {
      bump(target, 'toClear');
      bump(target, 'totalRecords');
    }
  }

  const assignees = Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name) || a.userId - b.userId);
  const totals = emptyCounts();
  for (const a of assignees) for (const k of COUNT_KEYS) totals[k] += a[k];

  // Sections in display order: the four buckets, then dependencies to
  // clear (their own section, matching their own summary tile). Within a
  // section: by assignee/owner name, then id.
  const sectionRank = (r: StatusReviewRecord) => (r.kind === 'task' ? BUCKET_ORDER.indexOf(r.bucket) : BUCKET_ORDER.length);
  const records: StatusReviewRecord[] = [...tasks, ...deps].sort(
    (a, b) => sectionRank(a) - sectionRank(b) || a.assigneeName.localeCompare(b.assigneeName) || a.id - b.id,
  );

  return { today, summary, assignees, totals, records };
}
