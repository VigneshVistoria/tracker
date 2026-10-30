import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { HANDOVER_AUDIT } from '../src/task-handovers/task-handovers';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';

// Performance Tracking C4 (2026-10-30): handover with a mandatory template;
// the next owner accepts (task reassigned) or rejects (reason); one
// pending per task; cancel; notifications; the nightly C4 row.
describe('Task handover (Performance Tracking C4, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let taskId: number;
  const template = {
    whatDone: 'Refund API and its unit tests',
    howToTest: 'POST /refunds with a paid claim',
    knownIssues: 'None known at this point',
    dependencies: 'Payments gateway sandbox keys',
    environment: 'Staging, branch feature/refunds',
  };

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const audits = (action: string) => ds.query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);
  const assignee = async () => (await ds.query(`SELECT "assigneeUserId" FROM project_tasks WHERE id = $1`, [taskId]))[0].assigneeUserId;
  const notified = async (userId: number, type: string) => {
    for (let i = 0; i < 40; i++) {
      if ((await ds.query(`SELECT 1 FROM user_notifications WHERE "userId" = $1 AND type = $2`, [userId, type])).length) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_handovers, performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, audit_logs, user_notifications RESTART IDENTITY CASCADE`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    taskId = (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', 'Refund flow', 'x', 'Development', $5, $6, $7, $8) RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('nothing while tracking is off', async () => {
    expect((await get(f.users.devA, `/tasks/${taskId}/handovers`).expect(200)).body).toEqual({ trackingOn: false });
    await post(f.users.devA, `/tasks/${taskId}/handovers`, { toUserId: f.users.devNone.id, ...template }).expect(400);
    await patch(f.users.pm, `/performance-tracking/projects/${f.projects.pA}`, { enabled: true }).expect(200);
  });

  it('only the assignee or a PM/Admin starts one; every field and a developer next owner are required', async () => {
    const { body } = await get(f.users.devA, `/tasks/${taskId}/handovers`).expect(200);
    expect(body).toMatchObject({ trackingOn: true, fieldMin: 10, canStart: true, handovers: [] });
    expect(body.candidates.map((c: any) => c.id)).not.toContain(f.users.devA.id);
    await post(f.users.qaB, `/tasks/${taskId}/handovers`, { toUserId: f.users.devNone.id, ...template }).expect(403);
    await post(f.users.devA, `/tasks/${taskId}/handovers`, { toUserId: f.users.devNone.id, ...template, knownIssues: 'none' }).expect(400);
    await post(f.users.devA, `/tasks/${taskId}/handovers`, { toUserId: f.users.qaB.id, ...template }).expect(400);
    await post(f.users.devA, `/tasks/${taskId}/handovers`, { toUserId: f.users.devA.id, ...template }).expect(400);
  });

  it('the next owner rejects with a reason; the task stays put', async () => {
    await post(f.users.devA, `/tasks/${taskId}/handovers`, { toUserId: f.users.devNone.id, ...template }).expect(201);
    expect(await notified(f.users.devNone.id, 'task.handoverStarted')).toBe(true);
    await post(f.users.devA, `/tasks/${taskId}/handovers`, { toUserId: f.users.devNone.id, ...template }).expect(400);
    const [h] = await ds.query(`SELECT id FROM task_handovers WHERE status = 'pending'`);
    await post(f.users.devA, `/task-handovers/${h.id}/accept`).expect(403);
    await post(f.users.devNone, `/task-handovers/${h.id}/reject`, { reason: 'short' }).expect(400);
    // While pending, the next owner can open the task.
    await get(f.users.devNone, `/tasks/${taskId}`).expect(200);
    const { body } = await post(f.users.devNone, `/task-handovers/${h.id}/reject`, { reason: 'No test data for the refund case' }).expect(201);
    // Their access ends with the decision.
    expect(body).toEqual({ decided: true, canViewTask: false });
    await get(f.users.devNone, `/tasks/${taskId}`).expect(403);
    const after = (await get(f.users.devA, `/tasks/${taskId}/handovers`).expect(200)).body;
    expect(after.handovers[0]).toMatchObject({ status: 'rejected', rejectReason: 'No test data for the refund case', decidedByName: 'Name devNone' });
    expect(await assignee()).toBe(f.users.devA.id);
    expect(await notified(f.users.devA.id, 'task.handoverRejected')).toBe(true);
    await post(f.users.devNone, `/task-handovers/${h.id}/accept`).expect(400);
  });

  it('a PM can start one for the assignee and cancel it', async () => {
    await post(f.users.pm, `/tasks/${taskId}/handovers`, { toUserId: f.users.devNone.id, ...template }).expect(201);
    const [h] = await ds.query(`SELECT id, "fromUserId", "startedByUserId" FROM task_handovers WHERE status = 'pending'`);
    expect(h).toMatchObject({ fromUserId: f.users.devA.id, startedByUserId: f.users.pm.id });
    await post(f.users.devNone, `/task-handovers/${h.id}/cancel`).expect(403);
    await post(f.users.devA, `/task-handovers/${h.id}/cancel`).expect(201);
  });

  it('accepting reassigns the task to the next owner (normal reassignment, audited)', async () => {
    await post(f.users.devA, `/tasks/${taskId}/handovers`, { toUserId: f.users.devNone.id, ...template }).expect(201);
    const [h] = await ds.query(`SELECT id FROM task_handovers WHERE status = 'pending'`);
    const { body } = await post(f.users.devNone, `/task-handovers/${h.id}/accept`).expect(201);
    expect(body.handovers[0].status).toBe('accepted');
    expect(await assignee()).toBe(f.users.devNone.id);
    expect(await audits('task_reassigned')).toHaveLength(1);
    expect((await audits(HANDOVER_AUDIT.STARTED)).length).toBe(3);
    expect(await audits(HANDOVER_AUDIT.ACCEPTED)).toHaveLength(1);
    expect(await audits(HANDOVER_AUDIT.REJECTED)).toHaveLength(1);
    expect(await audits(HANDOVER_AUDIT.CANCELLED)).toHaveLength(1);
    expect(await notified(f.users.devA.id, 'task.handoverAccepted')).toBe(true);
  });

  it('the nightly run: C4 = accepted share of the handovers the person gave (cancelled left out)', async () => {
    await ds.query(`UPDATE projects SET "performanceTrackingSince" = now() - interval '10 days' WHERE id = $1`, [f.projects.pA]);
    expect((await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' })).status).toBe('done');
    const [row] = await ds.query(`SELECT value, numerator, denominator FROM performance_metric_snapshots WHERE metric = 'C4' AND "userId" = $1`, [f.users.devA.id]);
    expect(row).toMatchObject({ numerator: 1, denominator: 2 });
    expect(Number(row.value)).toBe(50);
  });
});
