// Run with scripts/test-status-review.sh (Node's built-in test runner - no
// test packages installed in this repo). Never imported by the app.
//
// Fails if per-assignee totals differ from the overall summary, or if any
// record appears twice.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeStatusReview,
  COUNT_KEYS,
  ComputeInput,
  StatusReviewSummary,
  WORK_ITEM_STATUSES,
} from './status-review.compute';

function assertConsistent(r: StatusReviewSummary) {
  for (const k of COUNT_KEYS) {
    assert.equal(r.totals[k], r.summary[k], `totals.${k} must equal summary.${k}`);
  }
  const keys = r.records.map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length, 'a record id appears twice');
  assert.equal(r.summary.totalRecords, r.records.length, 'totalRecords must equal records listed');
  assert.equal(r.summary.totalRecords, r.summary.workItems + r.summary.toClear, 'totalRecords = work items + to clear');
  assert.equal(
    r.summary.workItems,
    r.summary.failed + r.summary.development + r.summary.qa + r.summary.intervention,
    'work items = the four buckets',
  );
  for (const a of r.assignees) {
    assert.equal(a.workItems, a.failed + a.development + a.qa + a.intervention, `${a.name}: work items = buckets`);
    assert.equal(a.totalRecords, a.workItems + a.toClear, `${a.name}: totalRecords`);
    assert.equal(a.totalRecords, r.records.filter((x) => x.assigneeUserId === a.userId).length, `${a.name}: records listed`);
  }
}

const task = (id: number, status: string, assigneeUserId: number | null, dueDate: string | null = null) => ({
  id, title: `T${id}`, status, assigneeUserId, dueDate, isDefect: false, priority: null, projectName: null, moduleName: null,
});
const dep = (id: number, parentTaskId: number, ownerUserId: number, createdByUserId = 9) => ({
  id, title: `D${id}`, parentTaskId, ownerUserId, createdByUserId, createdByEmail: null, createdAt: '2026-10-01',
});

test('fixture: hand-checked counts, no duplicates, totals match', () => {
  const input: ComputeInput = {
    today: '2026-10-04',
    userNames: new Map([[1, 'Ann'], [2, 'Bob'], [3, 'Cy'], [9, 'Filer']]),
    blockedTaskIds: [11],
    tasks: [
      task(10, 'Failed', 1, '2026-10-01'), // overdue
      task(11, 'Development', 1, '2026-10-06'), // due soon, blocked
      task(11, 'Development', 1, '2026-10-06'), // duplicate row - must be ignored
      task(12, 'Feedback', 2, '2026-10-20'),
      task(13, 'Escalated', 2),
      task(14, 'Released - With Showstoppers', 2, '2026-10-11'), // failed bucket, due soon (today+7)
      task(15, 'Pass', 1), // not a work item
      task(16, 'Development', null), // unassigned - not a work item
      task(17, 'Hold', 3), // not a work item
    ],
    openDependencies: [
      dep(100, 10, 2), // Ann's task waits on Bob
      dep(101, 11, 1), // owned by the task's own assignee
      dep(102, 15, 2), // parent is Pass - excluded
      dep(103, 12, 3), // Bob's task waits on Cy (Cy has no work items)
      dep(100, 10, 2), // duplicate - ignored
    ],
  };
  const r = computeStatusReview(input);
  assertConsistent(r);

  assert.deepEqual(
    { ...r.summary },
    { failed: 2, development: 1, qa: 1, intervention: 1, workItems: 5, toClear: 3, totalRecords: 8, overdue: 1, blocked: 1, dueSoon: 2, waitingOn: 2 },
  );
  const byName = Object.fromEntries(r.assignees.map((a) => [a.name, a]));
  assert.equal(byName.Ann.workItems, 2);
  assert.equal(byName.Ann.toClear, 1); // dep 101
  assert.equal(byName.Ann.waitingOn, 1); // dep 100 (101 is her own)
  assert.equal(byName.Ann.nextDue, '2026-10-06');
  assert.equal(byName.Bob.toClear, 1); // dep 100
  assert.equal(byName.Cy.workItems, 0);
  assert.equal(byName.Cy.toClear, 1); // dep 103 - listed under its owner
  const t10 = r.records.find((x) => x.key === 'task-10');
  assert.ok(t10 && t10.kind === 'task' && t10.waitingOn.length === 1 && t10.waitingOn[0].ownerName === 'Bob');
  const d100 = r.records.find((x) => x.key === 'dep-100');
  assert.ok(d100 && d100.kind === 'dependency' && d100.filedByName === 'Filer' && d100.parentTaskId === 10);
});

test('randomized data always stays consistent', () => {
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const statuses = [...WORK_ITEM_STATUSES, 'Pass', 'Junk', 'Hold', 'Closed', 'Released - No Showstoppers'];
  for (let run = 0; run < 300; run++) {
    const tasks = Array.from({ length: rand(40) }, () =>
      task(rand(60), statuses[rand(statuses.length)], rand(6) === 0 ? null : rand(5) + 1, rand(4) === 0 ? null : `2026-10-${String(rand(28) + 1).padStart(2, '0')}`),
    );
    const openDependencies = Array.from({ length: rand(25) }, () => dep(rand(40), rand(60), rand(6) + 1, rand(6) + 1));
    const r = computeStatusReview({
      today: '2026-10-14',
      userNames: new Map([[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D']]),
      blockedTaskIds: Array.from({ length: rand(5) }, () => rand(60)),
      tasks,
      openDependencies,
    });
    assertConsistent(r);
  }
});
