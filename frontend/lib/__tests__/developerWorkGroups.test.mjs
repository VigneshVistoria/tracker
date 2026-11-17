import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMyWork, statusInfo, fixReason, formatDmy, daysLate } from '../developerWorkGroups.js';

const today = '2026-11-17';
const ME = 7;
let nextId = 1;
const task = (status, extra = {}) => ({ id: nextId++, status, title: status, projectId: 1, projectName: 'LMS', dueDate: null, assigneeUserId: ME, dueDateCommittedByUserId: ME, pmWaitWorkingDays: 0, ...extra });

const ALL = ['Development', 'Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review', 'Pending PM Review', 'PM Feedback',
  'Returned to QA', 'Not Ready for Testing', 'Disputed', 'Escalated', 'Failed', 'Pass', 'Hold', 'Closed',
  'Released - No Showstoppers', 'Released - With Showstoppers'];

test('every status lands in the agreed group with the agreed label', () => {
  const expected = {
    Development: ['working', 'Working on it'],
    Failed: ['working', 'Fix needed'],
    'Released - With Showstoppers': ['working', 'Fix needed'],
    'PM Feedback': ['working', 'Fix needed'],
    'Not Ready for Testing': ['working', 'Fix needed'],
    Feedback: ['submitted', 'With QA'],
    'Re-Feedback': ['submitted', 'With QA'],
    'Returned to QA': ['submitted', 'With QA'],
    'Peer Review': ['submitted', 'With reviewer'],
    'Re-Peer-Review': ['submitted', 'With reviewer'],
    'Pending PM Review': ['submitted', 'Waiting for PM'],
    Disputed: ['submitted', 'Waiting for PM'],
    Escalated: ['submitted', 'Waiting for PM'],
    Hold: ['submitted', 'On hold'],
    Pass: ['submitted', 'Passed'],
  };
  for (const [s, [group, label]] of Object.entries(expected)) {
    assert.deepEqual([statusInfo(s).group, statusInfo(s).label], [group, label], s);
  }
  for (const s of ['Released - No Showstoppers', 'Closed', 'Junk']) assert.equal(statusInfo(s), null, s);
});

test('counts are the list lengths and every visible task appears exactly once', () => {
  const tasks = ALL.map((s) => task(s, { completedAt: '2026-11-15T10:00:00Z' }));
  const { working, submitted } = buildMyWork({ tasks, userId: ME, today });
  assert.equal(working.length, 5);
  assert.equal(submitted.length, 10);
  const ids = [...working, ...submitted].map((r) => r.key);
  assert.equal(new Set(ids).size, ids.length);
});

test('Passed stays 14 days, then drops off', () => {
  const recent = task('Pass', { completedAt: '2026-11-04T09:00:00Z' });
  const old = task('Pass', { completedAt: '2026-11-02T09:00:00Z' });
  const { submitted } = buildMyWork({ tasks: [recent, old], userId: ME, today });
  assert.deepEqual(submitted.map((r) => r.key), [`task-${recent.id}`]);
});

test('only Working can be late; Working sorts late, then Fix needed, then date', () => {
  const late = task('Development', { dueDate: '2026-11-14' });
  const fix = task('Failed', { dueDate: '2026-11-30' });
  const soon = task('Development', { dueDate: '2026-11-20' });
  const none = task('Development');
  const qa = task('Feedback', { dueDate: '2026-11-01' });
  const { working, submitted } = buildMyWork({ tasks: [none, soon, fix, late, qa], userId: ME, today });
  assert.deepEqual(working.map((r) => r.key), [late, fix, soon, none].map((t) => `task-${t.id}`));
  assert.equal(working[0].late, 3);
  assert.equal(submitted[0].late, 0);
});

test('action rows: dependency, peer review, handover, due date to confirm (tracking on only)', () => {
  const unconfirmed = task('Development', { dueDate: '2026-11-25', dueDateCommittedByUserId: null, projectId: 2 });
  const elsewhere = task('Development', { dueDate: '2026-11-25', dueDateCommittedByUserId: 99, projectId: 3 });
  const { working } = buildMyWork({
    tasks: [unconfirmed, elsewhere],
    ownedTickets: [{ id: 5, status: 'open', title: 'API key', parentTaskId: 40, needByDate: '2026-11-16', parentTaskProjectName: 'LMS' }, { id: 6, status: 'resolved', title: 'x', parentTaskId: 40 }],
    peerReviews: [{ id: 50, title: 'Review me', projectId: 1, projectName: 'LMS', qaReviewDueDate: '2026-11-19' }],
    handovers: [{ id: 9, taskId: 60, taskTitle: 'Login design', projectId: 1, projectName: 'LMS' }],
    trackingProjects: new Set([2]),
    userId: ME,
    today,
  });
  const labels = working.map((r) => r.status).sort();
  // The Working task needing confirmation stays one row, tagged.
  assert.deepEqual(labels, ['Accept handover', 'Review needed', 'Someone is waiting on you', 'Working on it', 'Working on it']);
  assert.equal(working.find((r) => r.key === `task-${unconfirmed.id}`).confirmDueDate, true);
  assert.equal(working.find((r) => r.key === `task-${elsewhere.id}`).confirmDueDate, undefined);
  // A Submitted task needing confirmation gets its own Working row.
  const sub = task('Feedback', { dueDate: '2026-11-25', dueDateCommittedByUserId: null, projectId: 2 });
  const both = buildMyWork({ tasks: [sub], trackingProjects: new Set([2]), userId: ME, today });
  assert.deepEqual([both.working.map((r) => r.status), both.submitted.length], [['Confirm due date'], 1]);
  assert.equal(working[0].status, 'Someone is waiting on you'); // late first
});

test('blocked line and multi-project flag', () => {
  const t = task('Development', { projectName: 'Insurance' });
  const { working, multiProject } = buildMyWork({
    tasks: [t, task('Feedback')],
    inboundTickets: [{ id: 1, status: 'open', parentTaskId: t.id, ownerName: 'Asha', title: 'DB access' }],
    userId: ME,
    today,
  });
  assert.deepEqual(working[0].blocked, ['Blocked: waiting on Asha (DB access)']);
  assert.equal(multiProject, true);
});

test('fix reason says who sent it back', () => {
  const r = (extra) => ({ roundNumber: 1, status: 'rejected', reviewType: 'qa', qaComment: null, ...extra });
  assert.equal(fixReason({ status: 'Failed' }, [r({ testFailedReason: 'Crash', qaComment: '<p>On save &amp; exit</p>' })]), 'QA: Crash - On save & exit');
  assert.equal(fixReason({ status: 'PM Feedback' }, [r({ reviewType: 'pm', qaComment: '<p>Add tests</p>' })]), 'PM: Add tests');
  assert.equal(fixReason({ status: 'PM Feedback' }, [r({ status: 'withdrawn', qaComment: 'Wrong build' })]), 'PM: Wrong build');
  assert.equal(fixReason({ status: 'Not Ready for Testing' }, [r({ status: 'not_ready', notReadyReason: 'No build link' })]), 'Not ready: No build link');
  assert.equal(fixReason({ status: 'Failed' }, []), 'QA: no reason given');
  // Latest decided round wins; reverted/pending ignored.
  assert.equal(fixReason({ status: 'Failed' }, [r({ qaComment: 'old' }), r({ roundNumber: 2, qaComment: 'new' }), r({ roundNumber: 3, status: 'reverted', qaComment: 'x' })]), 'QA: new');
});

test('dates', () => {
  assert.equal(formatDmy('2026-11-07'), '07-11-2026');
  assert.equal(daysLate('2026-11-16', today), 1);
  assert.equal(daysLate('2026-11-17', today), 0);
});
