import { computeScrumWindow, isValidTimeZone, lastWorkingDayBefore, startOfDayInZone } from '../src/daily-scrum/daily-scrum-window';
import { computeDailyScrum, ComputeScrumInput, ScrumTaskInput } from '../src/daily-scrum/daily-scrum.compute';

// Daily Scrum Stage 1 (2026-10-12): the date window and the grouping
// rules, tested with a fixed "now" and no database.
describe('Daily Scrum window', () => {
  const EAT = 'Africa/Addis_Ababa';
  const window = (iso: string, tz = EAT) => {
    const w = computeScrumWindow(new Date(iso), tz);
    return { today: w.today, lastWorkingDay: w.lastWorkingDay, since: w.since.toISOString() };
  };

  it('Monday 08:00 EAT looks back to Friday 00:00 EAT (21:00 UTC Thursday)', () => {
    expect(window('2026-10-12T05:00:00Z')).toEqual({ today: '2026-10-12', lastWorkingDay: '2026-10-09', since: '2026-10-08T21:00:00.000Z' });
  });

  it('Monday 01:00 EAT is still Sunday in UTC, but it is Monday for the team', () => {
    expect(window('2026-10-11T22:00:00Z')).toEqual({ today: '2026-10-12', lastWorkingDay: '2026-10-09', since: '2026-10-08T21:00:00.000Z' });
  });

  it('Saturday and Sunday look back to Friday; Tuesday to Monday; Friday to Thursday', () => {
    expect(window('2026-10-10T09:00:00Z').lastWorkingDay).toBe('2026-10-09');
    expect(window('2026-10-11T09:00:00Z').lastWorkingDay).toBe('2026-10-09');
    expect(window('2026-10-13T09:00:00Z')).toEqual({ today: '2026-10-13', lastWorkingDay: '2026-10-12', since: '2026-10-11T21:00:00.000Z' });
    expect(window('2026-10-09T09:00:00Z').lastWorkingDay).toBe('2026-10-08');
  });

  it('working hours never cut the window - it always starts at 00:00', () => {
    // 06:00 EAT, before the 07:30 start: still Friday 00:00.
    expect(window('2026-10-12T03:00:00Z').since).toBe('2026-10-08T21:00:00.000Z');
  });

  it('follows the configured zone, including daylight-saving changes', () => {
    expect(window('2026-10-11T22:00:00Z', 'UTC')).toEqual({ today: '2026-10-11', lastWorkingDay: '2026-10-09', since: '2026-10-09T00:00:00.000Z' });
    expect(startOfDayInZone('2026-03-06', 'America/New_York').toISOString()).toBe('2026-03-06T05:00:00.000Z');
    expect(startOfDayInZone('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('crosses month and year boundaries', () => {
    expect(lastWorkingDayBefore('2026-11-02')).toBe('2026-10-30');
    expect(lastWorkingDayBefore('2027-01-01')).toBe('2026-12-31');
    // 2027-01-01 is a Friday - no holiday calendar, so Monday looks back to it.
    expect(lastWorkingDayBefore('2027-01-04')).toBe('2027-01-01');
  });

  it('recognises real time zone names only', () => {
    expect(isValidTimeZone('Africa/Addis_Ababa')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    for (const bad of ['', '  ', 'Mars/Phobos', 'EAT+3', null, 5]) expect(isValidTimeZone(bad)).toBe(false);
  });
});

describe('Daily Scrum grouping', () => {
  const TODAY = '2026-10-12';
  let nextId = 1;
  const task = (values: Partial<ScrumTaskInput>): ScrumTaskInput => ({
    id: nextId++,
    title: 'T',
    status: 'Development',
    assigneeUserId: 1,
    dueDate: '2026-12-31',
    isDefect: false,
    priority: null,
    projectName: 'P',
    moduleName: 'M',
    ...values,
  });

  const base = (overrides: Partial<ComputeScrumInput>): ComputeScrumInput => ({
    people: [
      { userId: 1, name: 'Dev One', role: 'developer' },
      { userId: 2, name: 'Dev Two', role: 'developer' },
    ],
    tasks: [],
    blockedTaskIds: [],
    openDependencies: [],
    pendingPeerReviews: [],
    events: [],
    qaByUserId: new Map(),
    userNames: new Map([[1, 'Dev One'], [2, 'Dev Two']]),
    today: TODAY,
    ...overrides,
  });

  it('puts every active ticket in exactly one group, with reasons as chips', () => {
    const plain = task({});
    const overdue = task({ dueDate: '2026-10-09' });
    const dueToday = task({ dueDate: TODAY });
    const failed = task({ status: 'Failed' });
    const showstopper = task({ status: 'Released - With Showstoppers' });
    const escalated = task({ status: 'Escalated' });
    const defectBlocked = task({});
    const waiting = task({});
    const inQaOverdue = task({ status: 'Feedback', dueDate: '2026-10-01' });
    const inPeer = task({ status: 'Re-Peer-Review' });
    const many = task({ status: 'Failed', dueDate: '2026-10-01' });
    const result = computeDailyScrum(
      base({
        tasks: [plain, overdue, dueToday, failed, showstopper, escalated, defectBlocked, waiting, inQaOverdue, inPeer, many],
        blockedTaskIds: [defectBlocked.id, many.id],
        openDependencies: [
          { id: 900, title: 'Need API', parentTaskId: waiting.id, parentTaskTitle: 'W', parentTaskStatus: 'Development', parentTaskDueDate: null, parentAssigneeUserId: 1, ownerUserId: 2, createdByUserId: 1, createdAt: new Date() },
        ],
      }),
    );
    const one = result.people[0];
    const ids = (items: { taskId: number }[]) => items.map((i) => i.taskId).sort((a, b) => a - b);
    expect(ids(one.today)).toEqual([plain.id, dueToday.id]);
    expect(ids(one.withReviewers)).toEqual([inQaOverdue.id, inPeer.id]);
    expect(ids(one.blockers)).toEqual([overdue.id, failed.id, showstopper.id, escalated.id, defectBlocked.id, waiting.id, many.id].sort((a, b) => a - b));
    const reasonsOf = (id: number) => [...one.blockers, ...one.withReviewers].find((i) => i.taskId === id)!.reasons;
    expect(reasonsOf(overdue.id)).toEqual(['overdue']);
    expect(reasonsOf(showstopper.id)).toEqual(['sent_back']);
    expect(reasonsOf(escalated.id)).toEqual(['intervention']);
    expect(reasonsOf(defectBlocked.id)).toEqual(['blocking_defect']);
    expect(reasonsOf(waiting.id)).toEqual(['waiting_on_dependency']);
    expect(reasonsOf(inQaOverdue.id)).toEqual(['overdue']);
    expect(reasonsOf(many.id)).toEqual(['sent_back', 'blocking_defect', 'overdue']);
    expect(one.counts).toEqual({ today: 2, blockers: 7, withReviewers: 2, active: 11 });
    // Every blocker once in "Needs your attention", most reasons first.
    expect(result.needsAttention.map((n) => n.taskId).sort((a, b) => a - b)).toEqual(ids(one.blockers));
    expect(result.needsAttention[0].taskId).toBe(many.id);
    expect(result.totalsMatch).toBe(true);
  });

  it('leaves out Pass, Junk, Hold, Closed and Released - No Showstoppers, and duplicates', () => {
    const keep = task({});
    const result = computeDailyScrum(
      base({
        tasks: ['Pass', 'Junk', 'Hold', 'Closed', 'Released - No Showstoppers'].map((status) => task({ status, dueDate: '2020-01-01' })).concat([keep, keep]),
      }),
    );
    expect(result.people[0].counts.active).toBe(1);
    expect(result.activeTicketCount).toBe(1);
    expect(result.totalsMatch).toBe(true);
  });

  it('lists a dependency under its owner without counting it as their work, and hides it when the parent is Junk/Hold/Closed', () => {
    const parent = task({ assigneeUserId: 1 });
    const dep = (id: number, parentTaskStatus: string) => ({
      id, title: `Dep ${id}`, parentTaskId: parent.id, parentTaskTitle: 'Parent', parentTaskStatus, parentTaskDueDate: '2026-10-20', parentAssigneeUserId: 1, ownerUserId: 2, createdByUserId: 1, createdAt: new Date(),
    });
    const result = computeDailyScrum(base({ tasks: [parent], openDependencies: [dep(1, 'Development'), dep(2, 'Hold'), dep(3, 'Junk')] }));
    const two = result.people[1];
    expect(two.waitingOnYou.map((d) => d.dependencyId)).toEqual([1]);
    expect(two.waitingOnYou[0].requestedByName).toBe('Dev One');
    expect(two.counts.active).toBe(0);
    expect(result.totals.active).toBe(1);
  });

  it('shows peer reviews to do to the reviewer as a reference list only', () => {
    const t = task({ status: 'Peer Review', assigneeUserId: 1 });
    const result = computeDailyScrum(
      base({
        tasks: [t],
        pendingPeerReviews: [
          { taskId: t.id, title: t.title, taskStatus: 'Peer Review', assigneeUserId: 1, reviewerUserId: 2, roundNumber: 1, submittedAt: new Date() },
          { taskId: 999, title: 'Held one', taskStatus: 'Hold', assigneeUserId: 1, reviewerUserId: 2, roundNumber: 1, submittedAt: new Date() },
        ],
      }),
    );
    expect(result.people[1].peerReviewsToDo.map((r) => r.taskId)).toEqual([t.id]);
    expect(result.people[1].peerReviewsToDo[0].assigneeName).toBe('Dev One');
    expect(result.people[1].counts.active).toBe(0);
    expect(result.people[0].withReviewers.map((i) => i.taskId)).toEqual([t.id]);
  });

  it('only counts tickets of people on the page, and gives each person their own events, newest first', () => {
    const mine = task({ assigneeUserId: 1 });
    const someoneElse = task({ assigneeUserId: 77 });
    const result = computeDailyScrum(
      base({
        people: [{ userId: 1, name: 'Dev One', role: 'developer' }],
        tasks: [mine, someoneElse],
        events: [
          { userId: 1, at: new Date('2026-10-09T08:00:00Z'), kind: 'assigned', taskId: mine.id, title: 'T' },
          { userId: 1, at: new Date('2026-10-12T06:00:00Z'), kind: 'submitted_for_review', taskId: mine.id, title: 'T' },
          { userId: 2, at: new Date('2026-10-12T06:00:00Z'), kind: 'assigned', taskId: 5, title: 'X' },
        ],
      }),
    );
    expect(result.activeTicketCount).toBe(1);
    expect(result.people[0].since.map((e) => e.kind)).toEqual(['submitted_for_review', 'assigned']);
  });
});
