import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// PM "Send back to developer" (2026-10-16): PM/Admin pull a task waiting
// for QA (Feedback/Re-Feedback) back to the developer with a reason. The
// pending QA round is closed as 'withdrawn', the task goes to PM Feedback,
// and nothing QA-side counts it - the next submit is first-time Feedback.
describe('Send back to developer from QA (e2e)', () => {
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
  const statuses = async (id: number) => (await rounds(id)).map((r: any) => `${r.reviewType}:${r.status}`);

  const REASON = 'Description is not clear - add the expected behaviour';
  const artifacts = [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }];
  const submit = (id: number, u: FixtureUser = f.users.devA) =>
    post(u, `/tasks/${id}/qa-submit`, { resolution: '<p>Fixed it</p>', actualHours: 2, artifacts }).expect(201);
  const reject = (id: number) => patch(f.users.qaB, `/tasks/${id}/qa-reject`, { comment: 'Please provide proper resolution' }).expect(200);
  const sendBack = (u: FixtureUser, id: number, body: any = {}) => patch(u, `/tasks/${id}/qa-send-back`, { reason: REASON, ...body });
  const queueIds = async () => ((await get(f.users.qaB, '/tasks/qa-queue').expect(200)).body.tasks as any[]).map((t) => t.id);
  const summaryIds = async (tile: string) =>
    ((await get(f.users.pm, `/tasks/qa-summary/items?period=today&tile=${tile}`).expect(200)).body as any[]).map((r) => r.id);
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
      title: `Send-back task ${seq}`,
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

  it('needs a login (401), PM or Admin (403 for everyone else) and a 10+ character reason (400)', async () => {
    const id = await newTask();
    await submit(id);
    await http().patch(`/tasks/${id}/qa-send-back`).send({ reason: REASON }).expect(401);
    for (const u of [f.users.devA, f.users.qaB, f.users.exec]) {
      expect((await sendBack(u, id).expect(403)).body.message).toMatch(/Program Manager or Admin/);
    }
    await sendBack(f.users.pm, id, { reason: '  too short ' }).expect(400);
    await sendBack(f.users.pm, id, { reason: undefined }).expect(400);
    expect((await taskRow(id)).status).toBe('Feedback');
    expect(await statuses(id)).toEqual(['qa:pending']);
  });

  it('Feedback -> PM Feedback: out of the QA queue, round withdrawn, QA due date cleared, audited, developer told', async () => {
    const id = await newTask();
    await submit(id);
    expect((await taskRow(id)).qaReviewDueDate).not.toBeNull();
    expect(await queueIds()).toContain(id);
    expect(await summaryIds('waiting')).toContain(id);

    const res = await sendBack(f.users.pm, id).expect(200);
    expect(res.body.task.status).toBe('PM Feedback');
    const t = await taskRow(id);
    expect(t.status).toBe('PM Feedback');
    expect(t.qaReviewDueDate).toBeNull();
    expect(t.assigneeUserId).toBe(f.users.devA.id);
    expect(await queueIds()).not.toContain(id);
    expect(await summaryIds('waiting')).not.toContain(id);

    const [r] = await rounds(id);
    expect(r).toMatchObject({ status: 'withdrawn', reviewType: 'qa', reviewedByUserId: f.users.pm.id });
    expect(r.qaComment).toBe(`<p>${REASON}</p>`);

    const [audit] = await ds.query(`SELECT * FROM audit_logs WHERE action = 'task_pm_sent_back_from_qa' AND "entityId" = $1`, [id]);
    expect(audit.userId).toBe(f.users.pm.id);
    expect(JSON.parse(audit.details)).toMatchObject({
      reason: REASON,
      roundNumber: 1,
      statusFrom: 'Feedback',
      statusTo: 'PM Feedback',
      previousAssigneeUserId: f.users.devA.id,
      assigneeUserId: f.users.devA.id,
      reassigned: false,
      selfReview: false,
    });

    // Review history shows who sent it back.
    const history = (await get(f.users.devA, `/tasks/${id}/qa-reviews`).expect(200)).body;
    expect(history[0]).toMatchObject({ status: 'withdrawn', reviewedByFullName: 'Name pm' });

    const sent = await notes(id, 'task.pmSentBackFromQa');
    expect(sent.map((n: any) => n.userId)).toEqual([f.users.devA.id]);
    expect(sent[0].body).toContain(REASON);

    // QA can no longer decide it.
    await patch(f.users.qaB, `/tasks/${id}/qa-approve`, {}).expect(400);
  });

  it('the resubmit is a first-time Feedback, not Re-Feedback (and back in the QA queue)', async () => {
    const id = await newTask();
    await submit(id);
    await sendBack(f.users.pm, id).expect(200);
    await submit(id);
    expect((await taskRow(id)).status).toBe('Feedback');
    expect(await statuses(id)).toEqual(['qa:withdrawn', 'qa:pending']);
    expect(await queueIds()).toContain(id);
    expect(await summaryIds('waiting')).toContain(id);
    expect(await summaryIds('refeedback')).not.toContain(id);
  });

  it('from Re-Feedback: an earlier real QA rejection still makes the resubmit Re-Feedback', async () => {
    const id = await newTask();
    await submit(id);
    await reject(id);
    await submit(id);
    expect((await taskRow(id)).status).toBe('Re-Feedback');
    await sendBack(f.users.admin, id).expect(200);
    const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'task_pm_sent_back_from_qa' AND "entityId" = $1`, [id]);
    expect(JSON.parse(audit.details).statusFrom).toBe('Re-Feedback');
    await submit(id);
    expect((await taskRow(id)).status).toBe('Re-Feedback');
    expect(await statuses(id)).toEqual(['qa:rejected', 'qa:withdrawn', 'qa:pending']);
  });

  it('with the PM review gate on, the resubmit goes to the PM, then to QA as first-time Feedback', async () => {
    const id = await newTask();
    await submit(id);
    await sendBack(f.users.pm, id).expect(200);
    await ds.query(`UPDATE projects SET "pmReviewEnabled" = true WHERE id = $1`, [f.projects.pA]);
    try {
      await submit(id);
      expect((await taskRow(id)).status).toBe('Pending PM Review');
      await patch(f.users.pm, `/pm-review/tasks/${id}/send-to-qa`, {}).expect(200);
      expect((await taskRow(id)).status).toBe('Feedback');
      expect(await statuses(id)).toEqual(['qa:withdrawn', 'pm:approved', 'qa:pending']);
    } finally {
      await ds.query(`UPDATE projects SET "pmReviewEnabled" = false`);
    }
  });

  it('is not counted as a QA rejection, approval or defect raised (QA Summary, KPI)', async () => {
    const id = await newTask({ dueDate: new Date().toISOString().slice(0, 10) });
    await submit(id);
    await sendBack(f.users.pm, id).expect(200);
    for (const tile of ['rejected', 'approved', 'waiting', 'refeedback']) {
      expect(await summaryIds(tile)).not.toContain(id);
    }
    const { KpiService } = await import('../src/kpi/kpi.service');
    const rows = await app.get(KpiService).generatePeriod('daily', new Date(), f.tenants.t1);
    const mine = rows.find((r: any) => r.assigneeUserId === f.users.devA.id && r.projectId === f.projects.pA)!;
    const [{ rejected, withdrawn }] = await ds.query(
      `SELECT count(*) FILTER (WHERE r.status = 'rejected')::int AS rejected, count(*) FILTER (WHERE r.status = 'withdrawn')::int AS withdrawn
         FROM task_qa_reviews r JOIN project_tasks t ON t.id = r."taskId"
        WHERE r."reviewType" = 'qa' AND t."assigneeUserId" = $1 AND t."projectId" = $2`,
      [f.users.devA.id, f.projects.pA],
    );
    expect(withdrawn).toBeGreaterThan(0);
    expect(mine.qaRejectionCount).toBe(rejected);
  });

  it('PM can send it to another developer: reassigned, audited, both developers told', async () => {
    const id = await newTask();
    await submit(id);
    await sendBack(f.users.pm, id, { assigneeUserId: f.users.devNone.id }).expect(200);
    const t = await taskRow(id);
    expect(t).toMatchObject({ status: 'PM Feedback', assigneeUserId: f.users.devNone.id, assigneeEmail: f.users.devNone.email });
    const audits = await ds.query(`SELECT action, details FROM audit_logs WHERE "entityId" = $1 AND action IN ('task_pm_sent_back_from_qa', 'task_reassigned') ORDER BY id`, [id]);
    expect(audits.map((a: any) => a.action)).toEqual(['task_pm_sent_back_from_qa', 'task_reassigned']);
    expect(JSON.parse(audits[0].details)).toMatchObject({ reassigned: true, previousAssigneeUserId: f.users.devA.id, assigneeUserId: f.users.devNone.id });
    expect((await notes(id, 'task.pmSentBackFromQa')).map((n: any) => n.userId)).toEqual([f.users.devNone.id]);
    expect((await notes(id, 'task.reassigned')).map((n: any) => n.userId)).toEqual([f.users.devA.id]);
    // The new developer is the one who resubmits.
    await submit(id, f.users.devNone);
    expect((await taskRow(id)).status).toBe('Feedback');
  });

  it('only a PM may pick another developer, and only a Developer/Designer/DevOps user', async () => {
    const id = await newTask();
    await submit(id);
    expect((await sendBack(f.users.admin, id, { assigneeUserId: f.users.devNone.id }).expect(403)).body.message).toMatch(/Only a Program Manager/);
    expect((await sendBack(f.users.pm, id, { assigneeUserId: f.users.qaB.id }).expect(400)).body.message).toMatch(/Developer, Designer or DevOps/);
    await sendBack(f.users.pm, id, { assigneeUserId: 999999 }).expect(404);
    expect((await taskRow(id)).status).toBe('Feedback');
    // Admin naming the current developer is fine.
    await sendBack(f.users.admin, id, { assigneeUserId: f.users.devA.id }).expect(200);
  });

  it('a task with no developer needs one picked (PM), and Admin is told to ask a PM', async () => {
    const id = await newTask();
    await submit(id);
    await ds.query(`UPDATE project_tasks SET "assigneeUserId" = NULL, "assigneeEmail" = NULL WHERE id = $1`, [id]);
    expect((await sendBack(f.users.admin, id).expect(400)).body.message).toMatch(/Program Manager needs to pick/);
    expect((await sendBack(f.users.pm, id).expect(400)).body.message).toMatch(/pick who to send it to/);
    await sendBack(f.users.pm, id, { assigneeUserId: f.users.devA.id }).expect(200);
    expect((await taskRow(id)).assigneeUserId).toBe(f.users.devA.id);
  });

  it('the PM sending back their own task is allowed and flagged', async () => {
    const id = await newTask({ assigneeUserId: f.users.pm.id, assigneeEmail: f.users.pm.email });
    await submit(id, f.users.pm);
    await sendBack(f.users.pm, id).expect(200);
    const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'task_pm_sent_back_from_qa' AND "entityId" = $1`, [id]);
    expect(JSON.parse(audit.details).selfReview).toBe(true);
    // No notification to yourself.
    expect(await notes(id, 'task.pmSentBackFromQa')).toEqual([]);
  });

  it('is refused outside Feedback/Re-Feedback, for defects, Junk and Hold', async () => {
    const dev = await newTask();
    expect((await sendBack(f.users.pm, dev).expect(400)).body.message).toMatch(/not waiting for QA \(it is Development\)/);

    const failed = await newTask();
    await submit(failed);
    await reject(failed);
    expect((await sendBack(f.users.pm, failed).expect(400)).body.message).toMatch(/it is Failed/);

    const escalated = await newTask();
    await submit(escalated);
    await patch(f.users.qaB, `/tasks/${escalated}/qa-escalate`, { comment: 'unclear' }).expect(200);
    await sendBack(f.users.pm, escalated).expect(400);

    const defect = await newTask({ isDefect: true, createdByUserId: f.users.qaB.id, createdByEmail: f.users.qaB.email });
    await submit(defect);
    expect((await sendBack(f.users.pm, defect).expect(400)).body.message).toMatch(/is a defect/);
    expect((await taskRow(defect)).status).toBe('Feedback');

    const held = await newTask();
    await submit(held);
    await ds.query(`UPDATE project_tasks SET status = 'Hold', "priorStatus" = 'Feedback' WHERE id = $1`, [held]);
    await sendBack(f.users.pm, held).expect(400);

    const junk = await newTask();
    await submit(junk);
    await ds.query(`UPDATE project_tasks SET status = 'Junk', "statusBeforeJunk" = 'Feedback' WHERE id = $1`, [junk]);
    await sendBack(f.users.pm, junk).expect(400);
  });

  it('two send-backs at once: exactly one wins; a second one later says who already did it', async () => {
    const id = await newTask();
    await submit(id);
    const results = await Promise.all([sendBack(f.users.pm, id), sendBack(f.users.admin, id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await statuses(id)).toEqual(['qa:withdrawn']);
    const audits = await ds.query(`SELECT 1 FROM audit_logs WHERE action = 'task_pm_sent_back_from_qa' AND "entityId" = $1`, [id]);
    expect(audits).toHaveLength(1);
    expect((await sendBack(f.users.pm, id).expect(400)).body.message).toMatch(/already sent back to the developer/);
  });

  it('QA approving while a PM sends back: exactly one wins, never both', async () => {
    for (let i = 0; i < 3; i++) {
      const id = await newTask();
      await submit(id);
      const [qa, pm] = await Promise.all([patch(f.users.qaB, `/tasks/${id}/qa-approve`, {}), sendBack(f.users.pm, id)]);
      expect([qa.status, pm.status].filter((s) => s === 200)).toHaveLength(1);
      const t = await taskRow(id);
      const [r] = await rounds(id);
      if (qa.status === 200) {
        expect(t.status).toBe('Pass');
        expect(r.status).toBe('approved');
      } else {
        expect(t.status).toBe('PM Feedback');
        expect(r.status).toBe('withdrawn');
      }
    }
  });

  it('QA decisions still work normally, and a withdrawn round is not a decision Revert can undo', async () => {
    const id = await newTask();
    await submit(id);
    await reject(id);
    expect((await taskRow(id)).status).toBe('Failed');
    await submit(id);
    await patch(f.users.qaB, `/tasks/${id}/qa-escalate`, { comment: 'unclear' }).expect(200);
    expect((await taskRow(id)).status).toBe('Escalated');

    const other = await newTask();
    await submit(other);
    await sendBack(f.users.pm, other).expect(200);
    expect((await patch(f.users.pm, `/tasks/${other}/qa-revert`, { reason: 'mistake' }).expect(400)).body.message).toMatch(/no QA decision to revert/);
    // Reject -> revert after a withdrawn round: back to Feedback (the
    // withdrawn round is no earlier decision).
    await submit(other);
    await reject(other);
    await patch(f.users.pm, `/tasks/${other}/qa-revert`, { reason: 'mistake' }).expect(200);
    expect((await taskRow(other)).status).toBe('Feedback');
  });
});
