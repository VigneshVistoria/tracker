import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Revert QA decision (2026-10-13): PM/Admin undo the latest QA approve or
// reject made by mistake. The decided round stays as history ('reverted'),
// a fresh pending round re-opens the same submission, the decision stops
// counting, and defects the rejection created are junked.
describe('Revert QA decision (e2e)', () => {
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

  const artifacts = [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }];
  const submit = (id: number) => post(f.users.devA, `/tasks/${id}/qa-submit`, { resolution: '<p>Fixed it</p>', actualHours: 2, artifacts }).expect(201);
  const reject = (id: number, body: any = {}) => patch(f.users.qaB, `/tasks/${id}/qa-reject`, { comment: 'Please provide proper resolution', ...body }).expect(200);
  const approve = (id: number) => patch(f.users.qaB, `/tasks/${id}/qa-approve`, {}).expect(200);
  const revert = (u: FixtureUser, id: number, reason = 'QA rejected this by mistake') => patch(u, `/tasks/${id}/qa-revert`, { reason });
  const summary = async () => (await get(f.users.pm, '/tasks/qa-summary?period=today').expect(200)).body;
  const summaryIds = async (tile: string) =>
    ((await get(f.users.pm, `/tasks/qa-summary/items?period=today&tile=${tile}`).expect(200)).body as any[]).map((r) => r.id);

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
      title: `Revert task ${seq}`,
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

  it('needs a login (401), PM or Admin (403 for everyone else) and a reason (400)', async () => {
    const id = await newTask();
    await submit(id);
    await reject(id);
    await http().patch(`/tasks/${id}/qa-revert`).send({ reason: 'mistake' }).expect(401);
    for (const u of [f.users.devA, f.users.qaB, f.users.exec]) {
      expect((await revert(u, id).expect(403)).body.message).toMatch(/Program Manager or Admin/);
    }
    await revert(f.users.pm, id, '  ').expect(400);
    expect((await taskRow(id)).status).toBe('Failed');
  });

  it('reverting a rejection puts the same submission back in the QA queue, with the rejection kept as history', async () => {
    const id = await newTask();
    await submit(id);
    const [submitted] = await rounds(id);
    await reject(id);
    expect(await summaryIds('rejected')).toContain(id);

    const res = await revert(f.users.pm, id, 'QA rejected this by mistake').expect(200);
    expect(res.body.junkedDefectIds).toEqual([]);
    expect((await taskRow(id)).status).toBe('Feedback');

    const [r1, r2] = await rounds(id);
    expect(r1).toMatchObject({ roundNumber: 1, status: 'reverted', revertedDecision: 'rejected', revertedByUserId: f.users.pm.id, revertReason: 'QA rejected this by mistake' });
    expect(r1.reviewedByUserId).toBe(f.users.qaB.id);
    expect(r1.qaComment).toMatch(/proper resolution/);
    expect(r2).toMatchObject({ roundNumber: 2, status: 'pending', reviewType: 'qa', resolution: submitted.resolution, submittedByUserId: f.users.devA.id });
    expect(new Date(r2.submittedAt).getTime()).toBe(new Date(submitted.submittedAt).getTime());
    const copied = await ds.query(`SELECT type, url FROM task_qa_review_artifacts WHERE "taskQaReviewId" = $1`, [r2.id]);
    expect(copied).toEqual([{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }]);

    // No longer counts as a rejection; counts as waiting (first time).
    expect(await summaryIds('rejected')).not.toContain(id);
    expect(await summaryIds('waiting')).toContain(id);
    const waitingRow = ((await get(f.users.pm, '/tasks/qa-summary/items?period=today&tile=waiting').expect(200)).body as any[]).find((r) => r.id === id);
    expect(waitingRow.rejections).toBe(0);

    const [audit] = await ds.query(`SELECT * FROM audit_logs WHERE action = 'task_qa_decision_reverted' AND "entityId" = $1`, [id]);
    expect(audit.userId).toBe(f.users.pm.id);
    expect(JSON.parse(audit.details)).toMatchObject({ reason: 'QA rejected this by mistake', revertedDecision: 'rejected', statusFrom: 'Failed', statusTo: 'Feedback', roundNumber: 1, newRoundNumber: 2 });

    // History endpoint shows the reverted round with who reverted it.
    const history = (await get(f.users.devA, `/tasks/${id}/qa-reviews`).expect(200)).body;
    expect(history.find((r: any) => r.roundNumber === 1)).toMatchObject({ status: 'reverted', revertedByFullName: 'Name pm' });

    // Developer and QA are told.
    await new Promise((r) => setTimeout(r, 200));
    const notes = await ds.query(`SELECT "userId" FROM user_notifications WHERE type = 'task.reviewReverted' AND link = $1 ORDER BY "userId"`, [`/tasks/${id}`]);
    expect(notes.map((n: any) => n.userId).sort()).toEqual([f.users.devA.id, f.users.qaB.id].sort());

    // QA can now decide the re-opened round normally.
    await approve(id);
    expect((await taskRow(id)).status).toBe('Pass');
  });

  it('can only be done once per decision, and not after the developer resubmitted', async () => {
    const id = await newTask();
    await submit(id);
    await reject(id);
    await revert(f.users.pm, id).expect(200);
    expect((await revert(f.users.pm, id).expect(400)).body.message).toMatch(/waiting for review/);

    const other = await newTask();
    await submit(other);
    await reject(other);
    await submit(other);
    expect((await revert(f.users.pm, other).expect(400)).body.message).toMatch(/waiting for review \(round 2\)/);
    expect((await taskRow(other)).status).toBe('Re-Feedback');
  });

  it('is refused once the task has moved on (Hold), for a Peer Review decision, and for an escalation', async () => {
    const held = await newTask();
    await submit(held);
    await reject(held);
    await ds.query(`UPDATE project_tasks SET status = 'Hold', "priorStatus" = 'Failed' WHERE id = $1`, [held]);
    expect((await revert(f.users.pm, held).expect(400)).body.message).toMatch(/moved on .* now Hold/);

    const peer = await newTask({ status: 'Failed' });
    await ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", resolution, "submittedByUserId", "submittedByEmail", status, "reviewType", "reviewedAt")
       VALUES ($1, $2, 1, 'x', $3, $4, 'rejected', 'peer', now())`,
      [f.tenants.t1, peer, f.users.devA.id, f.users.devA.email],
    );
    expect((await revert(f.users.pm, peer).expect(400)).body.message).toMatch(/Peer Review/);

    const escalated = await newTask();
    await submit(escalated);
    await patch(f.users.qaB, `/tasks/${escalated}/qa-escalate`, { comment: 'unclear' }).expect(200);
    expect((await revert(f.users.pm, escalated).expect(400)).body.message).toMatch(/escalated/);
  });

  it('Admin can revert an approval: back to waiting, completedAt cleared, no longer approved', async () => {
    const id = await newTask();
    await submit(id);
    await approve(id);
    expect((await taskRow(id)).completedAt).not.toBeNull();
    expect(await summaryIds('approved')).toContain(id);

    await revert(f.users.admin, id, 'Approved the wrong ticket').expect(200);
    const t = await taskRow(id);
    expect(t.status).toBe('Feedback');
    expect(t.completedAt).toBeNull();
    expect(await summaryIds('approved')).not.toContain(id);
    // The resubmit guard (assertNotAlreadyApproved) no longer sees an approval.
    expect((await rounds(id)).map((r: any) => r.status)).toEqual(['reverted', 'pending']);
    expect((await rounds(id))[0].revertedDecision).toBe('approved');
  });

  it('after an earlier real rejection, the task goes back to Re-Feedback', async () => {
    const id = await newTask();
    await submit(id);
    await reject(id);
    await submit(id);
    await reject(id);
    await revert(f.users.pm, id).expect(200);
    expect((await taskRow(id)).status).toBe('Re-Feedback');
    expect((await rounds(id)).map((r: any) => r.status)).toEqual(['rejected', 'reverted', 'pending']);
  });

  it('junks the defects the reverted rejection created, unless one is already being worked on', async () => {
    const linkedDefects = [{ title: 'Broken button', description: 'x', assigneeUserId: f.users.devA.id }];
    const id = await newTask();
    await submit(id);
    const defectId = (await reject(id, { linkedDefects })).body.linkedDefects[0].id;
    const res = await revert(f.users.pm, id).expect(200);
    expect(res.body.junkedDefectIds).toEqual([defectId]);
    const d = await taskRow(defectId);
    expect(d.status).toBe('Junk');
    expect(d.statusBeforeJunk).toBe('Development');
    expect(d.junkReason).toMatch(new RegExp(`QA rejection of task #${id} reverted`));
    const [junkAudit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'task_marked_junk' AND "entityId" = $1`, [defectId]);
    expect(JSON.parse(junkAudit.details).source).toBe('qa-revert');

    const busy = await newTask();
    await submit(busy);
    const busyDefect = (await reject(busy, { linkedDefects })).body.linkedDefects[0].id;
    await ds.query(`UPDATE project_tasks SET status = 'Feedback' WHERE id = $1`, [busyDefect]);
    expect((await revert(f.users.pm, busy).expect(400)).body.message).toMatch(new RegExp(`#${busyDefect} .* already being worked on`));
    expect((await taskRow(busy)).status).toBe('Failed');
    expect((await taskRow(busyDefect)).status).toBe('Feedback');
  });
});
