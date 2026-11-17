import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMyWork, statusInfo, fixReason, formatDmy, daysLate, waitingLabel, workingLabel } from '../developerWorkGroups.js';

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

test('only Working can be late; Working sorts no due date ("Set due date"), then late (most first), then soonest date', () => {
  const late = task('Development', { dueDate: '2026-11-14' });
  const later = task('Development', { dueDate: '2026-11-10' });
  const fix = task('Failed', { dueDate: '2026-11-30' });
  const soon = task('Development', { dueDate: '2026-11-20' });
  const none = task('Development');
  const qa = task('Feedback', { dueDate: '2026-11-01' });
  const { working, submitted } = buildMyWork({ tasks: [soon, fix, late, qa, later, none], userId: ME, today });
  assert.deepEqual(working.map((r) => r.key), [none, later, late, soon, fix].map((t) => `task-${t.id}`));
  assert.deepEqual(working.map((r) => Boolean(r.setDueDate)), [true, false, false, false, false]);
  assert.deepEqual([working[1].late, working[2].late], [7, 3]);
  assert.equal(submitted[0].late, 0);
  assert.equal(submitted[0].setDueDate, undefined);
});

test('Submitted sorts by submitted date, newest first; never submitted last', () => {
  const a = task('Feedback', { dueDate: '2026-11-01' });
  const b = task('Peer Review', { dueDate: '2026-11-30' });
  const c = task('Hold', { dueDate: '2026-11-05' });
  const d = task('Pass', { dueDate: '2026-11-02', completedAt: '2026-11-16T00:00:00Z' });
  const activity = new Map([
    [a.id, { taskId: a.id, lastSubmittedAt: '2026-11-10T09:00:00.000Z' }],
    [b.id, { taskId: b.id, lastSubmittedAt: '2026-11-15T09:00:00.000Z' }],
    [c.id, { taskId: c.id, lastSubmittedAt: null }],
    [d.id, { taskId: d.id, lastSubmittedAt: '2026-11-12T09:00:00.000Z' }],
  ]);
  const { submitted } = buildMyWork({ tasks: [a, b, c, d], activity, userId: ME, today });
  assert.deepEqual(submitted.map((r) => r.key), [b, d, a, c].map((t) => `task-${t.id}`));
  // A handover / peer review / dependency without a date is not "Set due date".
  const { working } = buildMyWork({ handovers: [{ id: 9, taskId: 60, taskTitle: 'Login', projectId: 1, projectName: 'LMS' }], userId: ME, today });
  assert.equal(working[0].setDueDate, undefined);
});

test('action rows: dependency, peer review, handover, due date to confirm (tracking on only)', () => {
  const unconfirmed = task('Development', { dueDate: '2026-11-25', dueDateCommittedByUserId: null, projectId: 2 });
  const elsewhere = task('Development', { dueDate: '2026-11-25', dueDateCommittedByUserId: 99, projectId: 3 });
  const { working } = buildMyWork({
    tasks: [unconfirmed, elsewhere],
    ownedTickets: [{ id: 5, status: 'open', title: 'API key', parentTaskId: 40, needByDate: '2026-11-16', parentTaskProjectName: 'LMS', createdByName: 'Nadia' }, { id: 6, status: 'resolved', title: 'x', parentTaskId: 40 }],
    peerReviews: [{ id: 50, title: 'Review me', projectId: 1, projectName: 'LMS', qaReviewDueDate: '2026-11-19', assigneeUserId: 31, assigneeFullName: 'Ahmed' }],
    handovers: [{ id: 9, taskId: 60, taskTitle: 'Login design', projectId: 1, projectName: 'LMS' }],
    trackingProjects: new Set([2]),
    userId: ME,
    today,
  });
  const labels = working.map((r) => r.status).sort();
  // The Working task needing confirmation stays one row, tagged.
  assert.deepEqual(labels, ['Accept handover', 'Nadia is waiting on you', "Review Ahmed's work", 'Working on it', 'Working on it']);
  assert.equal(working.find((r) => r.key === `task-${unconfirmed.id}`).confirmDueDate, true);
  assert.equal(working.find((r) => r.key === `task-${elsewhere.id}`).confirmDueDate, undefined);
  // A Submitted task needing confirmation gets its own Working row.
  const sub = task('Feedback', { dueDate: '2026-11-25', dueDateCommittedByUserId: null, projectId: 2 });
  const both = buildMyWork({ tasks: [sub], trackingProjects: new Set([2]), userId: ME, today });
  assert.deepEqual([both.working.map((r) => r.status), both.submitted.length], [['Confirm due date'], 1]);
  // No date first (the handover), then late.
  assert.deepEqual([working[0].status, working[1].status], ['Accept handover', 'Nadia is waiting on you']);
});

test('blocked by someone else: moves to Submitted with the Blocked label; multi-project flag', () => {
  const t = task('Development', { projectName: 'Insurance' });
  const { working, submitted, multiProject } = buildMyWork({
    tasks: [t, task('Feedback')],
    inboundTickets: [{ id: 1, status: 'open', parentTaskId: t.id, ownerUserId: 44, ownerName: 'Asha', title: 'DB access' }],
    userId: ME,
    today,
  });
  assert.equal(working.length, 0);
  const row = submitted.find((r) => r.key === `task-${t.id}`);
  assert.deepEqual([row.status, row.blockedStatus, row.blocked, row.late], ['Blocked: waiting on Asha (DB access)', true, [], 0]);
  assert.equal(multiProject, true);
  // Resolved -> back in Working.
  const back = buildMyWork({ tasks: [t], inboundTickets: [{ id: 1, status: 'resolved', parentTaskId: t.id, ownerUserId: 44, title: 'DB access' }], userId: ME, today });
  assert.deepEqual([back.working.length, back.working[0].status], [1, 'Working on it']);
});

test('blocked by myself: stays in Working after the dependency, "Do X first", no Blocked', () => {
  const dep = task('Development', { title: 'Build API', dependencyTicketId: 9, dueDate: '2026-11-30' });
  const main = task('Development', { title: 'Screen', dueDate: '2026-11-18' });
  const ticket = { id: 9, status: 'open', parentTaskId: main.id, ownerUserId: ME, createdByUserId: ME, createdByName: 'Me', title: 'Build API', dependencyTask: { id: dep.id } };
  const { working, submitted } = buildMyWork({ tasks: [main, dep], inboundTickets: [ticket], ownedTickets: [ticket], userId: ME, today });
  assert.equal(submitted.length, 0);
  assert.deepEqual(working.map((r) => r.key), [`task-${dep.id}`, `task-${main.id}`]);
  const m = working[1];
  assert.deepEqual([m.status, m.blocked, m.doFirst], ['Working on it', [], ['Do Build API first']]);
  assert.equal(working[0].waiting, null); // not "Me is waiting on you"
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

test('a dependency ticket with a linked task shows once, as the task, with who is waiting', () => {
  const linked = task('Development', { title: 'F0 review', dependencyTicketId: 113 });
  const { working } = buildMyWork({
    tasks: [linked],
    ownedTickets: [
      { id: 113, status: 'open', title: 'F0 review', parentTaskId: 314, createdByName: 'Salman', dependencyTask: { id: linked.id } },
      { id: 120, status: 'open', title: 'Other', parentTaskId: 315, createdByName: null, createdByEmail: 'ahmed@example.invalid' },
    ],
    userId: ME,
    today,
  });
  assert.equal(working.length, 2);
  const row = working.find((r) => r.key === `task-${linked.id}`);
  assert.deepEqual([row.status, row.waiting], ['Working on it', 'Salman is waiting on you']);
  assert.equal(working.find((r) => r.key === 'dep-120').status, 'ahmed@example.invalid is waiting on you');
});

test('waiting label names everyone waiting', () => {
  assert.equal(waitingLabel(['Nadia']), 'Nadia is waiting on you');
  assert.equal(waitingLabel(['Nadia', 'Ahmed']), 'Nadia and Ahmed are waiting on you');
  assert.equal(waitingLabel(['Nadia', 'Ahmed', 'Sara', 'Nadia']), 'Nadia, Ahmed and Sara are waiting on you');
  assert.equal(waitingLabel([null]), 'Someone is waiting on you');
});

test('blocker flags: another person moves it to Submitted; a flag on a filed ticket counts once', () => {
  const a = task('Development');
  const b = task('Failed');
  const { working, submitted } = buildMyWork({
    tasks: [a, b],
    inboundTickets: [{ id: 7, status: 'open', parentTaskId: a.id, ownerUserId: 30, ownerName: 'Ravi', title: 'DB access' }],
    blockerFlags: new Map([
      [a.id, { blockingOwnerUserId: 30, blockingOwnerName: 'Ravi', dependencyTicketId: 7, reason: 'Waiting for DB access' }],
      [b.id, { blockingOwnerUserId: null, blockingOwnerName: 'Vendor X', dependencyTicketId: null, reason: 'Payment sandbox is down' }],
    ]),
    userId: ME,
    today,
  });
  assert.equal(working.length, 0);
  assert.deepEqual(submitted.map((r) => r.status).sort(), ['Blocked: waiting on Ravi (DB access)', 'Blocked: waiting on Vendor X (Payment sandbox is down)']);
  assert.deepEqual(submitted.find((r) => r.key === `task-${a.id}`).blocked, []);
});

test('no "waiting on you" while the requester\'s task is on Hold / Closed / Junk', () => {
  const linked = task('Development', { dependencyTicketId: 50 });
  const { working } = buildMyWork({
    tasks: [linked],
    ownedTickets: [
      { id: 50, status: 'open', title: 'A', parentTaskId: 1, parentTaskStatus: 'Hold', createdByName: 'Talha', dependencyTask: { id: linked.id } },
      { id: 51, status: 'open', title: 'B', parentTaskId: 2, parentTaskStatus: 'Hold', createdByName: 'Talha' },
      { id: 52, status: 'open', title: 'C', parentTaskId: 3, parentTaskStatus: 'Closed', createdByName: 'Talha' },
      { id: 53, status: 'open', title: 'D', parentTaskId: 4, parentTaskStatus: 'Development', createdByName: 'Talha' },
    ],
    userId: ME,
    today,
  });
  assert.deepEqual(working.map((r) => r.key).sort(), ['dep-53', `task-${linked.id}`].sort());
  assert.equal(working.find((r) => r.key === `task-${linked.id}`).waiting, null);
});

test('peer reviews: "Review <author>\'s work", review due date, late in red, never my own task', () => {
  const { working } = buildMyWork({
    peerReviews: [
      { id: 60, title: 'A', projectId: 1, projectName: 'LMS', qaReviewDueDate: '2026-11-14', assigneeUserId: 31, assigneeFullName: 'Ahmed' },
      { id: 61, title: 'B', projectId: 1, projectName: 'LMS', qaReviewDueDate: '2026-11-20', assigneeUserId: 32, assigneeFullName: 'James' },
      { id: 62, title: 'C', projectId: 1, projectName: 'LMS', qaReviewDueDate: null, assigneeUserId: 33, assigneeFullName: null, assigneeEmail: 'x@example.invalid' },
      { id: 63, title: 'Mine', projectId: 1, projectName: 'LMS', qaReviewDueDate: '2026-11-20', assigneeUserId: ME, assigneeFullName: 'Me' },
    ],
    userId: ME,
    today,
  });
  assert.deepEqual(working.map((r) => [r.ref, r.status, r.date, r.late]), [
    ['#62', "Review x@example.invalid's work", null, 0],
    ['#60', "Review Ahmed's work", '2026-11-14', 3],
    ['#61', "Review James's work", '2026-11-20', 0],
  ]);
});

test('"Working on it" splits into Not started / In progress · updated N days ago (display only)', () => {
  assert.equal(workingLabel(undefined, today), 'Working on it');
  assert.equal(workingLabel({ lastActivityAt: null }, today), 'Not started');
  assert.equal(workingLabel({ lastActivityAt: '2026-11-17T08:00:00.000Z' }, today), 'In progress · updated today');
  assert.equal(workingLabel({ lastActivityAt: '2026-11-16T23:00:00.000Z' }, today), 'In progress · updated 1 day ago');
  assert.equal(workingLabel({ lastActivityAt: '2026-11-05T10:00:00.000Z' }, today), 'In progress · updated 12 days ago');

  const fresh = task('Development');
  const busy = task('Development');
  const fix = task('Failed');
  const activity = new Map([
    [fresh.id, { taskId: fresh.id, lastActivityAt: null }],
    [busy.id, { taskId: busy.id, lastActivityAt: '2026-11-14T10:00:00.000Z' }],
  ]);
  const { working } = buildMyWork({ tasks: [fresh, busy, fix], activity, userId: ME, today });
  const byKey = new Map(working.map((r) => [r.key, r.status]));
  assert.equal(byKey.get(`task-${fresh.id}`), 'Not started');
  assert.equal(byKey.get(`task-${busy.id}`), 'In progress · updated 3 days ago');
  assert.equal(byKey.get(`task-${fix.id}`), 'Fix needed');
  // Still Development underneath: same group, same sort, same counts.
  assert.equal(working.length, 3);
  // Call failed (no map) -> the plain label.
  assert.equal(buildMyWork({ tasks: [fresh], userId: ME, today }).working[0].status, 'Working on it');
});
