import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { DESIGN_HANDOVER_AUDIT } from '../src/task-handovers/design-handovers';

// "Hand over to development" (2026-11-12, Option A, user decisions): a
// Designer's task is handed to a Developer/DevOps person with notes and
// links; started by the designer or a PM (not Admin); the developer links
// one of their tasks or creates one, and the design task goes to Pass;
// reject/cancel; every project (tracking off here).
describe('Design handover - Hand over to development (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let designTask: number;
  let devOwnTask: number;
  let otherTask: number;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const audits = (action: string) => ds.query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const pendingId = async () => (await ds.query(`SELECT id FROM task_handovers WHERE status = 'pending'`))[0]?.id;
  const notification = async (userId: number, type: string) => {
    for (let i = 0; i < 40; i++) {
      const rows = await ds.query(`SELECT * FROM user_notifications WHERE "userId" = $1 AND type = $2 ORDER BY id DESC`, [userId, type]);
      if (rows.length) return rows[0];
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };
  const insertTask = async (title: string, assignee: FixtureUser, status = 'Development') =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Design', $5, 'x', $6, $7, $8, $9, $10) RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, title, status, assignee.id, assignee.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;
  const links = [{ type: 'Prototype', url: 'https://figma.example/proto/1' }, { type: 'Design file', url: 'https://figma.example/file/1' }];
  const notes = 'Login redesign final: tokens, states and mobile layout.';

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_handovers, task_dependency_tickets, audit_logs, user_notifications RESTART IDENTITY CASCADE`);
    // devA plays the designer.
    await ds.query(`UPDATE users SET role = 'designer' WHERE id = $1`, [f.users.devA.id]);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Design') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    designTask = await insertTask('Login screen design', f.users.devA);
    devOwnTask = await insertTask('Build login screen', f.users.devNone);
    otherTask = await insertTask('Someone else', f.users.pm);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a Designer task offers it; a developer task does not', async () => {
    const { body } = await get(f.users.devA, `/tasks/${designTask}/design-handover`).expect(200);
    expect(body).toMatchObject({ isDesignTask: true, canStart: true, handovers: [], fieldMin: 10 });
    expect(body.receivers.map((r: any) => r.id)).toContain(f.users.devNone.id);
    expect(body.receivers.every((r: any) => ['developer', 'devops'].includes(r.role))).toBe(true);
    const dev = (await get(f.users.devNone, `/tasks/${devOwnTask}/design-handover`).expect(200)).body;
    expect(dev).toMatchObject({ isDesignTask: false, canStart: false });
    await post(f.users.devNone, `/tasks/${devOwnTask}/design-handover`, { toUserId: f.users.devA.id, notes, artifacts: links }).expect(400);
  });

  it('only the designer or a PM starts it (not Admin, not QA); notes, links and a Developer/DevOps receiver are required', async () => {
    const ok = { toUserId: f.users.devNone.id, notes, artifacts: links };
    await post(f.users.admin, `/tasks/${designTask}/design-handover`, ok).expect(403);
    await post(f.users.qaB, `/tasks/${designTask}/design-handover`, ok).expect(403);
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { ...ok, notes: 'short' }).expect(400);
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { ...ok, artifacts: [] }).expect(400);
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { ...ok, artifacts: [{ type: 'Prototype', url: 'figma.example/x' }] }).expect(400);
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { ...ok, artifacts: [{ type: 'Nope', url: 'https://x.example' }] }).expect(400);
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { ...ok, toUserId: f.users.qaB.id }).expect(400);
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { ...ok, toUserId: f.users.devA.id }).expect(400);
  });

  it('not while a review is waiting', async () => {
    await ds.query(`UPDATE project_tasks SET status = 'Feedback' WHERE id = $1`, [designTask]);
    const { body } = await get(f.users.devA, `/tasks/${designTask}/design-handover`).expect(200);
    expect(body.canStart).toBe(false);
    expect(body.startBlockedReason).toMatch(/Feedback/);
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { toUserId: f.users.devNone.id, notes, artifacts: links }).expect(400);
    await ds.query(`UPDATE project_tasks SET status = 'Failed' WHERE id = $1`, [designTask]);
  });

  it('the developer rejects with a reason; the design task stays with the designer', async () => {
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { toUserId: f.users.devNone.id, notes, artifacts: links }).expect(201);
    const started = await notification(f.users.devNone.id, 'task.designHandoverStarted');
    expect(started).toMatchObject({ link: `/tasks/${designTask}#design-handover` });
    const id = await pendingId();
    // One pending per task, of either kind; the C4 endpoints refuse it.
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { toUserId: f.users.devNone.id, notes, artifacts: links }).expect(400);
    await post(f.users.devNone, `/task-handovers/${id}/accept`).expect(400);
    // While pending the developer can open the design task and sees their tasks to link.
    await get(f.users.devNone, `/tasks/${designTask}`).expect(200);
    const view = (await get(f.users.devNone, `/tasks/${designTask}/design-handover`).expect(200)).body;
    expect(view.handovers[0]).toMatchObject({ status: 'pending', canDecide: true, notes, artifacts: links });
    expect(view.linkableTasks.map((t: any) => t.id)).toEqual([devOwnTask]);
    await post(f.users.devA, `/design-handovers/${id}/accept`, { linkTaskId: devOwnTask }).expect(403);
    await post(f.users.devNone, `/design-handovers/${id}/reject`, { reason: 'no' }).expect(400);
    const after = (await post(f.users.devNone, `/design-handovers/${id}/reject`, { reason: 'Mobile layout link is missing' }).expect(201)).body;
    expect(after).toEqual({ decided: true, canViewTask: false });
    expect((await taskRow(designTask)).status).toBe('Failed');
    expect(await notification(f.users.devA.id, 'task.designHandoverRejected')).toBeTruthy();
  });

  it('a PM can start it for the designer; cancel = PM or designer, not Admin', async () => {
    await post(f.users.pm, `/tasks/${designTask}/design-handover`, { toUserId: f.users.devNone.id, notes, artifacts: links }).expect(201);
    const id = await pendingId();
    const [h] = await ds.query(`SELECT "fromUserId", "startedByUserId", kind FROM task_handovers WHERE id = $1`, [id]);
    expect(h).toMatchObject({ fromUserId: f.users.devA.id, startedByUserId: f.users.pm.id, kind: 'design' });
    await post(f.users.admin, `/design-handovers/${id}/cancel`).expect(403);
    await post(f.users.devNone, `/design-handovers/${id}/cancel`).expect(403);
    await post(f.users.devA, `/design-handovers/${id}/cancel`).expect(201);
    expect(await notification(f.users.devNone.id, 'task.designHandoverCancelled')).toBeTruthy();
  });

  it('accepting by linking one of their own tasks: design task -> Pass, linked task shows the handover', async () => {
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { toUserId: f.users.devNone.id, notes, artifacts: links }).expect(201);
    const id = await pendingId();
    await post(f.users.devNone, `/design-handovers/${id}/accept`, {}).expect(400);
    await post(f.users.devNone, `/design-handovers/${id}/accept`, { linkTaskId: devOwnTask, newTaskTitle: 'Both' }).expect(400);
    await post(f.users.devNone, `/design-handovers/${id}/accept`, { linkTaskId: otherTask }).expect(400);
    const { body } = await post(f.users.devNone, `/design-handovers/${id}/accept`, { linkTaskId: devOwnTask }).expect(201);
    expect(body).toMatchObject({ linkedTaskId: devOwnTask, designTaskId: designTask });
    const design = await taskRow(designTask);
    expect(design).toMatchObject({ status: 'Pass', designHandoverId: id });
    expect(design.completedAt).not.toBeNull();
    // The developer keeps read access to the design task.
    await get(f.users.devNone, `/tasks/${designTask}`).expect(200);
    const linked = (await get(f.users.devNone, `/tasks/${devOwnTask}/design-handover`).expect(200)).body;
    expect(linked.linkedFrom).toHaveLength(1);
    expect(linked.linkedFrom[0]).toMatchObject({ taskId: designTask, notes, artifacts: links, fromName: 'Name devA' });
    expect(await audits(DESIGN_HANDOVER_AUDIT.ACCEPTED)).toHaveLength(1);
    expect(await audits(DESIGN_HANDOVER_AUDIT.TASK_CLOSED)).toHaveLength(1);
    expect(await notification(f.users.devA.id, 'task.designHandoverAccepted')).toMatchObject({ link: `/tasks/${devOwnTask}#design-handover` });
    // A Pass task can't be handed over again.
    await post(f.users.devA, `/tasks/${designTask}/design-handover`, { toUserId: f.users.devNone.id, notes, artifacts: links }).expect(400);
  });

  it('accepting by creating a new task: assigned to the developer, same module/phase, handover in the description', async () => {
    const second = await insertTask('Settings screen design', f.users.devA);
    await post(f.users.devA, `/tasks/${second}/design-handover`, { toUserId: f.users.devNone.id, notes, artifacts: links }).expect(201);
    const id = await pendingId();
    const { body } = await post(f.users.devNone, `/design-handovers/${id}/accept`, { newTaskTitle: 'Build settings screen' }).expect(201);
    const created = await taskRow(body.linkedTaskId);
    expect(created).toMatchObject({ title: 'Build settings screen', assigneeUserId: f.users.devNone.id, projectId: f.projects.pA, moduleId: f.modules.mA, phaseId, status: 'Development' });
    expect(created.description).toContain('https://figma.example/proto/1');
    expect(created.description).toContain(`#${second}`);
    expect((await taskRow(second)).status).toBe('Pass');
    const [h] = await ds.query(`SELECT "linkedTaskId" FROM task_handovers WHERE id = $1`, [id]);
    expect(h.linkedTaskId).toBe(body.linkedTaskId);
  });

  it('design handovers never show up as C4 handovers', async () => {
    await ds.query(`UPDATE projects SET "performanceTrackingEnabled" = true WHERE id = $1`, [f.projects.pA]);
    const { body } = await get(f.users.devA, `/tasks/${designTask}/handovers`).expect(200);
    expect(body.handovers).toEqual([]);
    await ds.query(`UPDATE projects SET "performanceTrackingEnabled" = false WHERE id = $1`, [f.projects.pA]);
  });
});
