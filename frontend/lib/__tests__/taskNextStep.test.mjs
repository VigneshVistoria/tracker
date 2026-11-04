// Run: node --test frontend/lib/__tests__/  (Node's built-in runner, no library)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskNextStep } from '../taskNextStep.js';

const base = { assigneeFullName: 'Asha Dev', qaReviewDueDate: '2026-11-10' };
const peerRound = { roundNumber: 2, status: 'pending', reviewType: 'peer', reviewerFullName: 'Dana Designer' };

test('QA review: QA team acts next, stored due date, late when past', () => {
  const s = taskNextStep({ ...base, status: 'Feedback', qaReviewDueDate: '2000-01-03' }, []);
  assert.deepEqual(s, { stage: 'QA review', who: 'QA team', due: '2000-01-03', late: true });
});

test('QA retest uses the same stored date (no separate deadline rule)', () => {
  const s = taskNextStep({ ...base, status: 'Re-Feedback', qaReviewDueDate: '2999-01-01' }, []);
  assert.equal(s.stage, 'QA retest');
  assert.equal(s.due, '2999-01-01');
  assert.equal(s.late, false);
});

test('defect retest names the QA who raised it', () => {
  const s = taskNextStep({ ...base, status: 'Re-Feedback', isDefect: true, createdByEmail: 'qa@x.test' }, []);
  assert.equal(s.who, 'qa@x.test');
});

test('peer review names the picked reviewer', () => {
  const s = taskNextStep({ ...base, status: 'Peer Review' }, [{ roundNumber: 1, status: 'rejected' }, peerRound]);
  assert.equal(s.stage, 'Peer review');
  assert.equal(s.who, 'Dana Designer');
});

test('sent back: the assignee acts next, no review deadline', () => {
  for (const status of ['Failed', 'PM Feedback', 'Not Ready for Testing']) {
    assert.deepEqual(taskNextStep({ ...base, status }, []), { stage: 'Fix and resubmit', who: 'Asha Dev', due: null, late: false });
  }
});

test('PM stages and hold go to the Program Manager', () => {
  for (const status of ['Pending PM Review', 'Escalated', 'Disputed', 'Hold']) {
    assert.equal(taskNextStep({ ...base, status }, []).who, 'Program Manager');
  }
});

test('Returned to QA shows no review deadline; Junk/Closed show nothing', () => {
  assert.equal(taskNextStep({ ...base, status: 'Returned to QA' }, []).due, null);
  assert.equal(taskNextStep({ ...base, status: 'Junk' }, []), null);
  assert.equal(taskNextStep({ ...base, status: 'Closed' }, []), null);
});
