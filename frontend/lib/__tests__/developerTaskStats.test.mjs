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
