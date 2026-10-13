import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Peer Review Stage 1 (2026-10-12): QA can't decide a peer round, the QA
// Review page's Approved/Rejected lists leave peer-decided tasks out,
// nothing is submitted or decided on a Held/Closed/finished task, Approve
// waits for open dependencies and blocking defects, and defects never go
// to Peer Review.
describe('Peer Review Stage 1 (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  const ids: Record<string, number> = {};

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const pendingRounds = async (id: number) =>
    (await ds.query(`SELECT count(*)::int n FROM task_qa_reviews WHERE "taskId" = $1 AND status = 'pending'`, [id]))[0].n;

  const artifacts = [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }];
  const peerSubmit = (u: FixtureUser, id: number, reviewer: FixtureUser) =>
    post(u, `/tasks/${id}/peer-review-submit`, { resolution: 'Done', actualHours: 2, artifacts, reviewerUserId: reviewer.id });
  const qaSubmit = (u: FixtureUser, id: number) => post(u, `/tasks/${id}/qa-submit`, { resolution: 'Done', actualHours: 2, artifacts });

  const task = async (key: string, values: Record<string, any>) => {
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pA,
      projectName: 'Project A',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'Build',
      title: `Task ${key}`,
      description: 'x',
      status: 'Development',
      estimatedHours: 4,
      dueDate: '2026-12-31',
      assigneeUserId: f.users.devA.id,
      assigneeEmail: f.users.devA.email,
      createdByUserId: f.users.pm.id,
      createdByEmail: f.users.pm.email,
      ...values,
    };
    const cols = Object.keys(row);
    const res = await ds.query(
      `INSERT INTO project_tasks (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    ids[key] = res[0].id;
  };

  const decidedRound = (taskId: number, roundNumber: number, status: string, reviewType: string) =>
    ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", "resolution", "submittedByUserId", "submittedByEmail", "status", "reviewType", "reviewedAt")
       VALUES ($1, $2, $3, 'done', $4, $5, $6, $7, now())`,
      [f.tenants.t1, taskId, roundNumber, f.users.devA.id, f.users.devA.email, status, reviewType],
    );

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_blocking_defects, user_notifications, audit_logs RESTART IDENTITY CASCADE`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;

    await task('peer', { peerReviewEnabled: true });
    await task('qaPassed', { status: 'Pass' });
    await decidedRound(ids.qaPassed, 1, 'approved', 'qa');
    // QA rejected first, then a peer passed it - the peer decided it.
    await task('peerPassedAfterQa', { status: 'Pass', peerReviewEnabled: true });
    await decidedRound(ids.peerPassedAfterQa, 1, 'rejected', 'qa');
    await decidedRound(ids.peerPassedAfterQa, 2, 'approved', 'peer');
    // Peer rejected first, then QA passed it (flag turned off) - QA decided it.
    await task('qaPassedAfterPeer', { status: 'Pass' });
    await decidedRound(ids.qaPassedAfterPeer, 1, 'rejected', 'peer');
    await decidedRound(ids.qaPassedAfterPeer, 2, 'approved', 'qa');
    await task('peerFailed', { status: 'Failed', peerReviewEnabled: true });
    await decidedRound(ids.peerFailed, 1, 'rejected', 'peer');
    await task('held', { status: 'Hold', priorStatus: 'Development' });
    await task('closed', { status: 'Closed', priorStatus: 'Development' });
    await task('defect', { isDefect: true, createdByUserId: f.users.qaB.id, createdByEmail: f.users.qaB.email });
    await task('flaggedDefect', { isDefect: true, peerReviewEnabled: true, createdByUserId: f.users.qaB.id, createdByEmail: f.users.qaB.email });
    // Approved, but the status drifted off Pass (the #57/#120 shape) -
    // assertNotAlreadyApproved() must still refuse a resubmit.
    await task('approvedDriftQa', { status: 'Development' });
    await decidedRound(ids.approvedDriftQa, 1, 'approved', 'qa');
    await task('approvedDriftPeer', { status: 'Development', peerReviewEnabled: true });
    await decidedRound(ids.approvedDriftPeer, 1, 'rejected', 'qa');
    await decidedRound(ids.approvedDriftPeer, 2, 'approved', 'peer');
    // Latest decision is not an approval - resubmit stays allowed.
    await task('qaFailed', { status: 'Failed' });
    await decidedRound(ids.qaFailed, 1, 'rejected', 'qa');
    await task('approvedThenRejected', { status: 'Failed' });
    await decidedRound(ids.approvedThenRejected, 1, 'approved', 'qa');
    await decidedRound(ids.approvedThenRejected, 2, 'rejected', 'qa');
    await task('escalatedReassigned', { status: 'Development' });
    await decidedRound(ids.escalatedReassigned, 1, 'escalated', 'qa');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('submitting', () => {
    it('a Peer Review task cannot be sent to QA directly', async () => {
      const res = await qaSubmit(f.users.devA, ids.peer).expect(400);
      expect(res.body.message).toMatch(/submit it for Peer Review/);
      expect(await pendingRounds(ids.peer)).toBe(0);
    });

    it('Held, Closed and Passed tasks cannot be submitted', async () => {
      expect((await qaSubmit(f.users.devA, ids.held).expect(400)).body.message).toMatch(/on Hold/);
      expect((await qaSubmit(f.users.devA, ids.closed).expect(400)).body.message).toMatch(/Closed/);
      expect((await qaSubmit(f.users.devA, ids.qaPassed).expect(400)).body.message).toMatch(/already Pass/);
      expect((await peerSubmit(f.users.devA, ids.peerPassedAfterQa, f.users.devNone).expect(400)).body.message).toMatch(/already Pass/);
      for (const key of ['held', 'closed', 'qaPassed', 'peerPassedAfterQa']) expect(await pendingRounds(ids[key])).toBe(0);
      expect((await taskRow(ids.qaPassed)).status).toBe('Pass');
    });

    it('a task whose latest decision is an approval cannot be resubmitted, whatever its status', async () => {
      const qa = await qaSubmit(f.users.devA, ids.approvedDriftQa).expect(400);
      expect(qa.body.message).toMatch(/already approved by QA \(round 1\).*reopen it for a re-check/);
      const peer = await peerSubmit(f.users.devA, ids.approvedDriftPeer, f.users.devNone).expect(400);
      expect(peer.body.message).toMatch(/already approved in Peer Review \(round 2\)/);
      for (const key of ['approvedDriftQa', 'approvedDriftPeer']) {
        expect(await pendingRounds(ids[key])).toBe(0);
        expect((await taskRow(ids[key])).status).toBe('Development');
      }
    });

    it('a rejection or an escalation as the latest decision still allows a resubmit', async () => {
      await qaSubmit(f.users.devA, ids.qaFailed).expect(201);
      expect((await taskRow(ids.qaFailed)).status).toBe('Re-Feedback');
      await qaSubmit(f.users.devA, ids.approvedThenRejected).expect(201);
      expect((await taskRow(ids.approvedThenRejected)).status).toBe('Re-Feedback');
      await qaSubmit(f.users.devA, ids.escalatedReassigned).expect(201);
      expect((await taskRow(ids.escalatedReassigned)).status).toBe('Re-Feedback');
    });

    it('a task already in review keeps the pending-round message', async () => {
      const res = await qaSubmit(f.users.devA, ids.qaFailed).expect(400);
      expect(res.body.message).toMatch(/already has a QA review round pending/);
    });

    it('a rejected (Failed) peer task can still be resubmitted', async () => {
      await peerSubmit(f.users.devA, ids.peerFailed, f.users.devNone).expect(201);
      expect((await taskRow(ids.peerFailed)).status).toBe('Re-Peer-Review');
    });

    it('the Assignee submits for Peer Review and it lands in the reviewer\'s queue', async () => {
      await peerSubmit(f.users.devA, ids.peer, f.users.devNone).expect(201);
      expect((await taskRow(ids.peer)).status).toBe('Peer Review');
      const queue = (await get(f.users.devNone, '/tasks/peer-review-queue').expect(200)).body.map((t: any) => t.id);
      expect(queue).toEqual(expect.arrayContaining([ids.peer, ids.peerFailed]));
    });
  });

  describe('QA cannot decide a peer round', () => {
    it('approve, reject and escalate are all refused and nothing changes', async () => {
      for (const action of ['qa-approve', 'qa-reject', 'qa-escalate']) {
        const res = await patch(f.users.qaB, `/tasks/${ids.peer}/${action}`, { comment: 'QA trying' }).expect(403);
        expect(res.body.message).toMatch(/only its assigned Peer Reviewer/);
      }
      expect((await taskRow(ids.peer)).status).toBe('Peer Review');
      expect(await pendingRounds(ids.peer)).toBe(1);
    });

    it('the pending peer task is not in the QA queue', async () => {
      const queue = (await get(f.users.qaB, '/tasks/qa-queue').expect(200)).body;
      expect(queue.tasks.map((t: any) => t.id)).not.toContain(ids.peer);
    });
  });

  describe('QA Review Approved/Rejected lists', () => {
    it('leave out tasks a peer decided, keep tasks QA decided', async () => {
      const queue = (await get(f.users.qaB, '/tasks/qa-queue').expect(200)).body;
      expect(queue.statCounts.approved).toBe(2); // qaPassed, qaPassedAfterPeer
      const passed = (await get(f.users.qaB, '/tasks/qa-queue?status=Pass').expect(200)).body.tasks.map((t: any) => t.id);
      expect(passed.sort()).toEqual([ids.qaPassed, ids.qaPassedAfterPeer].sort());
      const failed = (await get(f.users.qaB, '/tasks/qa-queue?status=Failed').expect(200)).body.tasks.map((t: any) => t.id);
      expect(failed).not.toContain(ids.peerFailed);
    });
  });

  describe('Peer Reviewer approving', () => {
    let ticketId: number;

    it('is blocked while a dependency ticket is open, with a clear message', async () => {
      ticketId = (
        await ds.query(
          `INSERT INTO task_dependency_tickets ("tenantId", "parentTaskId", "title", "description", "ownerUserId", "ownerEmail", "createdByUserId", "createdByEmail", "status")
           VALUES ($1, $2, 'Need API', 'x', $3, $4, $5, $6, 'open') RETURNING id`,
          [f.tenants.t1, ids.peer, f.users.devNone.id, f.users.devNone.email, f.users.devA.id, f.users.devA.email],
        )
      )[0].id;
      const res = await patch(f.users.devNone, `/tasks/${ids.peer}/peer-review-approve`, {}).expect(400);
      expect(res.body.message).toBe(`Cannot approve this Peer Review - resolve the open dependency ticket #${ticketId} first.`);
      expect((await taskRow(ids.peer)).status).toBe('Peer Review');
    });

    it('is blocked while a linked defect is unresolved', async () => {
      await ds.query(`UPDATE task_dependency_tickets SET status = 'resolved' WHERE id = $1`, [ticketId]);
      await ds.query(`UPDATE project_tasks SET "parentTaskId" = $1 WHERE id = $2`, [ids.peer, ids.defect]);
      const res = await patch(f.users.devNone, `/tasks/${ids.peer}/peer-review-approve`, {}).expect(400);
      expect(res.body.message).toBe(`Cannot approve this Peer Review - blocked by unresolved Defect #${ids.defect}. Resolve it first.`);
      await ds.query(`UPDATE project_tasks SET "parentTaskId" = NULL WHERE id = $1`, [ids.defect]);
    });

    it('rejecting is not blocked by an open dependency', async () => {
      await ds.query(`UPDATE task_dependency_tickets SET status = 'open' WHERE id = $1`, [ticketId]);
      await patch(f.users.devNone, `/tasks/${ids.peerFailed}/peer-review-reject`, { comment: 'Not yet' }).expect(200);
      await ds.query(`UPDATE task_dependency_tickets SET status = 'resolved' WHERE id = $1`, [ticketId]);
    });

    it('is blocked while the task is on Hold or Closed, then works once released', async () => {
      await patch(f.users.pm, `/tasks/${ids.peer}/hold`).expect(200);
      expect((await patch(f.users.devNone, `/tasks/${ids.peer}/peer-review-approve`, {}).expect(400)).body.message).toMatch(/on Hold/);
      expect((await patch(f.users.devNone, `/tasks/${ids.peer}/peer-review-reject`, { comment: 'x' }).expect(400)).body.message).toMatch(/on Hold/);
      await patch(f.users.pm, `/tasks/${ids.peer}/release`).expect(200);

      await patch(f.users.pm, `/tasks/${ids.peer}/close`).expect(200);
      expect((await patch(f.users.devNone, `/tasks/${ids.peer}/peer-review-approve`, {}).expect(400)).body.message).toMatch(/Closed/);
      await patch(f.users.pm, `/tasks/${ids.peer}/reopen`).expect(200);

      expect((await taskRow(ids.peer)).status).toBe('Peer Review');
      expect(await pendingRounds(ids.peer)).toBe(1);
      await patch(f.users.devNone, `/tasks/${ids.peer}/peer-review-approve`, {}).expect(200);
      const row = await taskRow(ids.peer);
      expect(row.status).toBe('Pass');
      expect(row.completedAt).toBeTruthy();
    });
  });

  describe('defects never go to Peer Review', () => {
    it('the PM cannot switch Peer Review on for a defect, but can switch a stray flag off', async () => {
      const res = await patch(f.users.pm, `/tasks/${ids.defect}/peer-review-flag`, { peerReviewEnabled: true }).expect(400);
      expect(res.body.message).toMatch(/Peer Review applies to tasks only/);
      expect((await taskRow(ids.defect)).peerReviewEnabled).toBe(false);
    });

    it('a defect that already has the flag goes to QA, not to a peer', async () => {
      await peerSubmit(f.users.devA, ids.flaggedDefect, f.users.devNone).expect(400);
      await qaSubmit(f.users.devA, ids.flaggedDefect).expect(201);
      expect((await taskRow(ids.flaggedDefect)).status).toBe('Feedback');
      await patch(f.users.pm, `/tasks/${ids.flaggedDefect}/peer-review-flag`, { peerReviewEnabled: false }).expect(200);
    });

    it('reassigning a defect to a QA user does not switch Peer Review on', async () => {
      await patch(f.users.pm, `/tasks/${ids.defect}/reassign`, { assigneeUserId: f.users.qaB.id }).expect(200);
      expect((await taskRow(ids.defect)).peerReviewEnabled).toBe(false);
      // Let the async assignment notification finish before the app closes.
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  });
});
