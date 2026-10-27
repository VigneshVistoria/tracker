import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { addBusinessDays, toDateOnlyString } from '../src/common/business-days';

// QA Reject as "Not ready for testing" (2026-10-27): QA could not start
// testing. The round closes as 'not_ready' with a reason from the editable
// list and a required comment, the task goes to Not Ready for Testing, and
// it is never a QA rejection - KPI, the rejection rate, QA acceptance and
// the QA Summary's Rejected tile leave it out. It is counted only as an
// "incomplete submission" (Non-compliance report, info only), and the
// resubmission is a first-time Feedback.
describe('QA "Not ready for testing" (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const rounds = (id: number) => ds.query(`SELECT * FROM task_qa_reviews WHERE "taskId" = $1 ORDER BY "roundNumber"`, [id]);
  // pg returns a date column as a Date at UTC midnight.
  const dateOnly = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const statuses = async (id: number) => (await rounds(id)).map((r: any) => `${r.reviewType}:${r.status}`);

  const REASON = 'Build not deployed';
  const COMMENT = '<p>The build on staging is still last week&#39;s - nothing to test.</p>';
  const artifacts = [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }];
  const submit = (id: number, u: FixtureUser = f.users.devA) =>
    post(u, `/tasks/${id}/qa-submit`, { resolution: '<p>Fixed it</p>', actualHours: 2, artifacts }).expect(201);
  const reject = (id: number) => patch(f.users.qaB, `/tasks/${id}/qa-reject`, { comment: 'Please provide proper resolution' }).expect(200);
  const notReady = (u: FixtureUser, id: number, body: any = {}) =>
    patch(u, `/tasks/${id}/qa-not-ready`, { reason: REASON, comment: COMMENT, ...body });
  const queue = async (u: FixtureUser = f.users.qaB, qs = '') => (await get(u, `/tasks/qa-queue${qs}`).expect(200)).body;
  const summaryIds = async (tile: string) =>
    ((await get(f.users.pm, `/tasks/qa-summary/items?period=today&tile=${tile}`).expect(200)).body as any[]).map((r) => r.id);
  const report = async () => (await get(f.users.pm, '/non-compliance-report').expect(200)).body;
  const devRow = async (u: FixtureUser = f.users.devA) => (await report()).developers.find((d: any) => d.userId === u.id);
  const notes = async (id: number, type: string) => {
    await new Promise((r) => setTimeout(r, 200));
    return ds.query(`SELECT "userId", title, body FROM user_notifications WHERE type = $1 AND link = $2 ORDER BY id`, [type, `/tasks/${id}`]);
  };

  const newTask = async (values: Record<string, any> = {}) => {
    seq += 1;
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pA,
      projectName: 'Project A',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'Build',
      title: `Not-ready task ${seq}`,
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
    return res[0].id as number;
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_qa_review_artifacts, task_qa_review_qa_artifacts, task_dependency_tickets, task_blocking_defects, user_notifications, audit_logs RESTART IDENTITY CASCADE`);
    await ds.query(`UPDATE projects SET "pmReviewEnabled" = false`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('needs a login (401) and the QA role (403); a reason from the list and a real comment are both required (400)', async () => {
    const id = await newTask();
    await submit(id);
    await http().patch(`/tasks/${id}/qa-not-ready`).send({ reason: REASON, comment: COMMENT }).expect(401);
    for (const u of [f.users.devA, f.users.pm, f.users.admin, f.users.exec]) {
      expect((await notReady(u, id).expect(403)).body.message).toMatch(/Only QA/);
    }
    await notReady(f.users.qaB, id, { reason: undefined }).expect(400);
    await notReady(f.users.qaB, id, { reason: '' }).expect(400);
    expect((await notReady(f.users.qaB, id, { reason: 'Felt like it' }).expect(400)).body.message).toMatch(/Pick a reason from the list/);
    await notReady(f.users.qaB, id, { comment: undefined }).expect(400);
    expect((await notReady(f.users.qaB, id, { comment: '<p>ok</p>' }).expect(400)).body.message).toMatch(/at least 10 characters/);
    await notReady(f.users.qaB, id, { comment: '<p>   </p><p><br></p>' }).expect(400);
    expect((await taskRow(id)).status).toBe('Feedback');
    expect(await statuses(id)).toEqual(['qa:pending']);
  });

  it('Feedback -> Not Ready for Testing: round closed with reason, QA clock stopped, out of the queue, audited, developer told', async () => {
    const id = await newTask();
    await submit(id);
    expect((await taskRow(id)).qaReviewDueDate).not.toBeNull();
    const before = await queue();
    expect(before.tasks.map((t: any) => t.id)).toContain(id);

    const res = await notReady(f.users.qaB, id, { artifacts: [{ type: 'Screenshot', url: 'https://example.com/shot.png' }] }).expect(200);
    expect(res.body).toMatchObject({ status: 'not_ready', notReadyReason: REASON });
    const t = await taskRow(id);
    expect(t.status).toBe('Not Ready for Testing');
    expect(t.qaReviewDueDate).toBeNull();

    const [r] = await rounds(id);
    expect(r).toMatchObject({ status: 'not_ready', reviewType: 'qa', notReadyReason: REASON, reviewedByUserId: f.users.qaB.id });
    expect(r.qaComment).toContain('nothing to test');
    expect(await ds.query(`SELECT type FROM task_qa_review_qa_artifacts WHERE "taskQaReviewId" = $1`, [r.id])).toEqual([{ type: 'Screenshot' }]);

    // Out of the pending queue, on its own "Not ready" card.
    const after = await queue();
    expect(after.tasks.map((t: any) => t.id)).not.toContain(id);
    expect(after.statCounts.pending).toBe(before.statCounts.pending - 1);
    expect(after.statCounts.notReady).toBe(before.statCounts.notReady + 1);
    expect(after.statCounts.rejected).toBe(before.statCounts.rejected);
    expect((await queue(f.users.qaB, `?status=${encodeURIComponent('Not Ready for Testing')}`)).tasks.map((t: any) => t.id)).toContain(id);
    expect((await queue(f.users.qaB, '?status=Failed')).tasks.map((t: any) => t.id)).not.toContain(id);

    // Still on the developer's My Tasks.
    expect(((await get(f.users.devA, '/tasks/mine').expect(200)).body as any[]).map((x) => x.id)).toContain(id);

    const [audit] = await ds.query(`SELECT * FROM audit_logs WHERE action = 'task_qa_not_ready' AND "entityId" = $1`, [id]);
    expect(audit.userId).toBe(f.users.qaB.id);
    expect(JSON.parse(audit.details)).toMatchObject({ reason: REASON, roundNumber: 1, statusFrom: 'Feedback', statusTo: 'Not Ready for Testing' });
    expect(await ds.query(`SELECT 1 FROM audit_logs WHERE action = 'task_qa_rejected' AND "entityId" = $1`, [id])).toEqual([]);

    const n = await notes(id, 'task.reviewNotReady');
    expect(n).toEqual([expect.objectContaining({ userId: f.users.devA.id, title: `QA could not test task #${id}: ${REASON}` })]);
    expect(await notes(id, 'task.reviewRejected')).toEqual([]);

    // Review history carries the reason.
    const history = (await get(f.users.devA, `/tasks/${id}/qa-reviews`).expect(200)).body;
    expect(history[0]).toMatchObject({ status: 'not_ready', notReadyReason: REASON, reviewedByFullName: 'Name qaB' });
  });

  it('the resubmit is a first-time Feedback with a fresh QA due date; an earlier real rejection still makes it Re-Feedback', async () => {
    const id = await newTask();
    await submit(id);
    await notReady(f.users.qaB, id).expect(200);
    await submit(id);
    let t = await taskRow(id);
    expect(t.status).toBe('Feedback');
    expect(dateOnly(t.qaReviewDueDate)).toBe(toDateOnlyString(addBusinessDays(new Date(), 5)));
    expect(await statuses(id)).toEqual(['qa:not_ready', 'qa:pending']);

    const other = await newTask();
    await submit(other);
    await reject(other);
    await submit(other);
    expect((await taskRow(other)).status).toBe('Re-Feedback');
    await notReady(f.users.qaB, other).expect(200);
    await submit(other);
    t = await taskRow(other);
    expect(t.status).toBe('Re-Feedback');
  });

  it('is not a QA rejection: KPI, rejection rate, QA Summary and pass rate leave it out; it is an incomplete submission instead', async () => {
    const devRowBefore = await devRow();
    const qaBefore = (await report()).qaNotReadyUsage.find((q: any) => q.userId === f.users.qaB.id);
    const id = await newTask({ dueDate: new Date().toISOString().slice(0, 10) });
    await submit(id);
    await notReady(f.users.qaB, id, { reason: 'Test steps missing' }).expect(200);

    for (const tile of ['rejected', 'approved', 'waiting', 'refeedback']) {
      expect(await summaryIds(tile)).not.toContain(id);
    }
    expect(await summaryIds('notReady')).toContain(id);
    const item = ((await get(f.users.pm, '/tasks/qa-summary/items?period=today&tile=notReady').expect(200)).body as any[]).find((r) => r.id === id);
    expect(item).toMatchObject({ notReadyReason: 'Test steps missing', notReadyCount: 1, qaUserId: f.users.qaB.id });

    const { KpiService } = await import('../src/kpi/kpi.service');
    const rows = await app.get(KpiService).generatePeriod('daily', new Date(), f.tenants.t1);
    const mine = rows.find((r: any) => r.assigneeUserId === f.users.devA.id && r.projectId === f.projects.pA)!;
    const [{ rejected, notReadyRounds }] = await ds.query(
      `SELECT count(*) FILTER (WHERE r.status = 'rejected')::int AS rejected, count(*) FILTER (WHERE r.status = 'not_ready')::int AS "notReadyRounds"
         FROM task_qa_reviews r JOIN project_tasks t ON t.id = r."taskId"
        WHERE r."reviewType" = 'qa' AND t."assigneeUserId" = $1 AND t."projectId" = $2`,
      [f.users.devA.id, f.projects.pA],
    );
    expect(notReadyRounds).toBeGreaterThan(0);
    expect(mine.qaRejectionCount).toBe(rejected);

    const after = await devRow();
    // Neither a submission nor a rejection in the rejection rate.
    expect(after.rejectionRate.submissions).toBe(devRowBefore.rejectionRate.submissions);
    expect(after.rejectionRate.rejections).toBe(devRowBefore.rejectionRate.rejections);
    // "Test failed" lists exactly the rate's rejections; not ready isn't one.
    expect(after.testFailed.count).toBe(after.rejectionRate.rejections);
    expect(after.testFailed.items.map((i: any) => i.taskId)).not.toContain(id);
    expect((await report()).notReadySince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(after.incompleteSubmissions.count).toBe(devRowBefore.incompleteSubmissions.count + 1);
    expect(after.incompleteSubmissions.items[0]).toMatchObject({
      taskId: id,
      reason: 'Test steps missing',
      qaUserId: f.users.qaB.id,
      qaName: 'Name qaB',
      status: 'Not Ready for Testing',
    });
    const qaAfter = (await report()).qaNotReadyUsage.find((q: any) => q.userId === f.users.qaB.id);
    expect(qaAfter.notReady).toBe(qaBefore.notReady + 1);
    expect(qaAfter.decisions).toBe(qaBefore.decisions + 1);

    // The PDF still renders with the new sections.
    const pdf = await get(f.users.pm, '/non-compliance-report/pdf').expect(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
  });

  it('Late to QA: the not-ready submission is no hand-over - past its due date it is still with the developer', async () => {
    const id = await newTask({ dueDate: '2026-01-05' });
    await submit(id);
    await notReady(f.users.qaB, id).expect(200);
    const late = (await devRow()).lateToQa.items.find((i: any) => i.taskId === id);
    expect(late).toMatchObject({ reason: 'still_with_developer', submittedAt: null });
  });

  it('Daily Scrum: the task is "sent back" for the developer, and the event reads as not ready', async () => {
    const id = await newTask();
    await submit(id);
    await notReady(f.users.qaB, id).expect(200);
    const person = (await get(f.users.devA, '/daily-scrum/me').expect(200)).body.person;
    const ticket = [...person.today, ...person.blockers, ...person.withReviewers].find((i: any) => i.taskId === id);
    expect(ticket.reasons).toContain('sent_back');
    expect(person.blockers.map((i: any) => i.taskId)).toContain(id);
    const event = person.since.find((e: any) => e.taskId === id && e.kind === 'review_sent_back');
    expect(event.detail).toBe(`QA, not ready for testing: ${REASON}`);
  });

  it('defects: only the QA who raised it, and it stays open in My Defects with its own count', async () => {
    const qaOther = (
      await ds.query(`INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, 'qa-nr-other@test.local', 'x', 'QA Other', 'qa') RETURNING id`, [f.tenants.t1])
    )[0].id;
    const foreign = await newTask({ isDefect: true, createdByUserId: qaOther, createdByEmail: 'qa-nr-other@test.local' });
    await submit(foreign);
    expect((await notReady(f.users.qaB, foreign).expect(403)).body.message).toMatch(/Only the QA who raised this defect/);

    const mine = await newTask({ isDefect: true, createdByUserId: f.users.qaB.id, createdByEmail: f.users.qaB.email });
    await submit(mine);
    await notReady(f.users.qaB, mine).expect(200);
    const defects = (await get(f.users.qaB, '/tasks/defect-queue').expect(200)).body;
    expect(defects.tasks.map((t: any) => t.id)).toContain(mine);
    expect(defects.statCounts.notReady).toBe(1);
    expect((await queue(f.users.qaB, `?include=defects&status=${encodeURIComponent('Not Ready for Testing')}`)).tasks.map((t: any) => t.id)).toContain(mine);
  });

  it('is refused when nothing is waiting for QA, for a Peer Review or PM round, and on Hold', async () => {
    const dev = await newTask();
    expect((await notReady(f.users.qaB, dev).expect(400)).body.message).toMatch(/no QA review round pending/);

    const done = await newTask();
    await submit(done);
    await notReady(f.users.qaB, done).expect(200);
    expect((await notReady(f.users.qaB, done).expect(400)).body.message).toMatch(/no QA review round pending/);

    const peer = await newTask({ status: 'Peer Review' });
    await ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", resolution, "submittedByUserId", "submittedByEmail", status, "reviewType", "reviewerUserId") VALUES ($1, $2, 1, 'x', $3, $4, 'pending', 'peer', $5)`,
      [f.tenants.t1, peer, f.users.devA.id, f.users.devA.email, f.users.devNone.id],
    );
    expect((await notReady(f.users.qaB, peer).expect(403)).body.message).toMatch(/Peer Review/);

    const pm = await newTask({ status: 'Pending PM Review' });
    await ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", resolution, "submittedByUserId", "submittedByEmail", status, "reviewType") VALUES ($1, $2, 1, 'x', $3, $4, 'pending', 'pm')`,
      [f.tenants.t1, pm, f.users.devA.id, f.users.devA.email],
    );
    expect((await notReady(f.users.qaB, pm).expect(403)).body.message).toMatch(/waiting for PM review/);

    const held = await newTask();
    await submit(held);
    await ds.query(`UPDATE project_tasks SET status = 'Hold', "priorStatus" = 'Feedback' WHERE id = $1`, [held]);
    await notReady(f.users.qaB, held).expect(400);
    expect(await statuses(held)).toEqual(['qa:pending']);
  });

  it('QA marking not ready while a PM sends it back: exactly one wins, never both', async () => {
    for (let i = 0; i < 3; i += 1) {
      const id = await newTask();
      await submit(id);
      const [a, b] = await Promise.all([
        notReady(f.users.qaB, id),
        patch(f.users.pm, `/tasks/${id}/qa-send-back`, { reason: 'Description is not clear enough' }),
      ]);
      expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
      const s = await statuses(id);
      expect(s).toHaveLength(1);
      expect(['qa:not_ready', 'qa:withdrawn']).toContain(s[0]);
      expect((await taskRow(id)).status).toBe(s[0] === 'qa:not_ready' ? 'Not Ready for Testing' : 'PM Feedback');
    }
  });

  it('Revert QA decision undoes a mistaken "not ready": back in the queue with the original QA due date', async () => {
    const id = await newTask();
    await submit(id);
    const due = dateOnly((await taskRow(id)).qaReviewDueDate);
    await notReady(f.users.qaB, id).expect(200);
    const res = await patch(f.users.pm, `/tasks/${id}/qa-revert`, { reason: 'QA picked not ready by mistake' }).expect(200);
    expect(res.body.task.status).toBe('Feedback');
    const t = await taskRow(id);
    expect(dateOnly(t.qaReviewDueDate)).toBe(due);
    const [old, fresh] = await rounds(id);
    expect(old).toMatchObject({ status: 'reverted', revertedDecision: 'not_ready', notReadyReason: REASON });
    expect(fresh).toMatchObject({ status: 'pending', reviewType: 'qa' });
    // Once the developer has resubmitted, there is nothing to undo.
    const later = await newTask();
    await submit(later);
    await notReady(f.users.qaB, later).expect(200);
    await submit(later);
    await patch(f.users.pm, `/tasks/${later}/qa-revert`, { reason: 'QA picked not ready by mistake' }).expect(400);
  });

  describe('reasons setting', () => {
    const reasonsUrl = '/qa-review/not-ready-reasons';

    it('QA, PM and Admin read the six defaults; others get 403', async () => {
      for (const u of [f.users.qaB, f.users.pm, f.users.admin]) {
        expect((await get(u, reasonsUrl).expect(200)).body.reasons).toEqual([
          'Build not deployed',
          'Test steps missing',
          'Evidence missing',
          'Environment not available',
          'Blocked by a dependency',
          'Description unclear',
        ]);
      }
      await get(f.users.devA, reasonsUrl).expect(403);
      await http().get(reasonsUrl).expect(401);
    });

    it('PM and Admin edit it (trimmed, no blanks or repeats, at least one); QA cannot; the task keeps the reason it was given', async () => {
      const id = await newTask();
      await submit(id);
      await notReady(f.users.qaB, id).expect(200);

      await patch(f.users.qaB, reasonsUrl, { reasons: ['x'] }).expect(403);
      await patch(f.users.pm, reasonsUrl, { reasons: [] }).expect(400);
      await patch(f.users.pm, reasonsUrl, { reasons: ['  '] }).expect(400);
      const saved = (await patch(f.users.pm, reasonsUrl, { reasons: [' Test data missing ', 'test data missing', '', 'Build not deployed'] }).expect(200)).body;
      expect(saved.reasons).toEqual(['Test data missing', 'Build not deployed']);
      expect((await get(f.users.qaB, reasonsUrl).expect(200)).body.reasons).toEqual(saved.reasons);
      const [audit] = await ds.query(`SELECT * FROM audit_logs WHERE action = 'qa_not_ready_reasons_updated' ORDER BY id DESC LIMIT 1`);
      expect(JSON.parse(audit.details).after).toEqual(saved.reasons);

      const other = await newTask();
      await submit(other);
      await notReady(f.users.qaB, other, { reason: 'Test steps missing' }).expect(400);
      await notReady(f.users.qaB, other, { reason: 'Test data missing' }).expect(200);
      expect((await rounds(id))[0].notReadyReason).toBe(REASON);

      await patch(f.users.admin, reasonsUrl, { reasons: ['Build not deployed', 'Test steps missing'] }).expect(200);
    });
  });
});
