import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdueTask, isQaReviewOverdue } from '../developerTaskStats.js';

const today = '2026-11-04';
const task = (status, extra = {}) => ({ status, dueDate: '2026-10-30', pmWaitWorkingDays: 0, ...extra });

test('waiting for QA or a peer is never the developer\'s overdue work', () => {
  for (const s of ['Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review']) {
    assert.equal(isOverdueTask(task(s), today), false, s);
  }
});

test('sent back after the due date is overdue from the original date', () => {
  for (const s of ['Development', 'Failed', 'PM Feedback', 'Not Ready for Testing']) {
    assert.equal(isOverdueTask(task(s), today), true, s);
  }
});

test('the review delay still shows separately', () => {
  assert.equal(isQaReviewOverdue(task('Feedback', { qaReviewDueDate: '2026-11-02' }), today), true);
  assert.equal(isQaReviewOverdue(task('Failed', { qaReviewDueDate: '2026-11-02' }), today), false);
});

// Dashboard cards (2026-11-04): a card's count and its list use the same rule.
import { isOpenTask, MY_TASK_CARD_FILTERS, countMyTaskCard } from '../developerTaskStats.js';

const ALL = ['Development', 'Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review', 'Pending PM Review', 'PM Feedback',
  'Returned to QA', 'Not Ready for Testing', 'Disputed', 'Escalated', 'Failed', 'Pass', 'Junk', 'Hold', 'Closed',
  'Released - No Showstoppers', 'Released - With Showstoppers'];

test('open excludes completed, Hold and Closed', () => {
  const notOpen = ALL.filter((s) => !isOpenTask({ status: s }));
  assert.deepEqual(notOpen.sort(), ['Closed', 'Hold', 'Junk', 'Pass', 'Released - No Showstoppers', 'Released - With Showstoppers'].sort());
});

test('released past its due date is not overdue', () => {
  assert.equal(isOverdueTask(task('Released - No Showstoppers'), today), false);
  assert.equal(isOverdueTask(task('Released - With Showstoppers'), today), false);
});

test('Open tasks leaves out Hold, Closed, done and work with a reviewer; On hold is Hold only', () => {
  const tasks = ALL.map((s, i) => ({ id: i, status: s, dueDate: null }));
  const open = tasks.filter((t) => MY_TASK_CARD_FILTERS.myTasks(t, today)).map((t) => t.status);
  assert.deepEqual(open, ['Development', 'PM Feedback', 'Not Ready for Testing', 'Disputed', 'Escalated', 'Failed']);
  assert.equal(countMyTaskCard('hold', tasks, today), 1);
  assert.equal(countMyTaskCard('waitingReview', tasks, today), 6);
  // Every open task is either the assignee's (Open tasks) or with a reviewer.
  assert.equal(countMyTaskCard('myTasks', tasks, today) + countMyTaskCard('waitingReview', tasks, today), tasks.filter(isOpenTask).length);
});

test('Open defects counts open defects only', () => {
  const defects = [{ status: 'Failed', isDefect: true }, { status: 'Hold', isDefect: true }, { status: 'Pass', isDefect: true }, { status: 'Development', isDefect: false }];
  assert.equal(countMyTaskCard('defects', defects, today), 1);
  assert.equal(countMyTaskCard('unknown', defects, today), 0);
});
