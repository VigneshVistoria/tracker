import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { DEFAULT_ESCALATION_REASONS } from '../src/task-qa-reviews/escalation-reasons';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';

// Performance Tracking O4 (2026-10-30): a reason on "Escalate to PM" on a
// tracked project, kept with its avoidable flag; the editable list; the
// nightly O4 row (avoidable escalations per 10 QA rounds).
describe('Escalation reasons (Performance Tracking O4, e2e)', () => {
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
  const round = async (id: number) => (await ds.query(`SELECT * FROM task_qa_reviews WHERE "taskId" = $1 ORDER BY "roundNumber" DESC`, [id]))[0];
  const artifacts = [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }];
  const submit = (id: number) => post(f.users.devA, `/tasks/${id}/qa-submit`, { resolution: '<p>Fixed it</p>', actualHours: 2, artifacts }).expect(201);
  const escalate = (id: number, body: any = {}) => patch(f.users.qaB, `/tasks/${id}/qa-escalate`, { comment: 'Needs a PM decision', ...body });
  const setTracking = (enabled: boolean) => patch(f.users.pm, `/performance-tracking/projects/${f.projects.pA}`, { enabled }).expect(200);
  const newTask = async () => {
    seq += 1;
    const res = await ds.query(
      `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "estimatedHours", "dueDate", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
       VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', $5, 'x', 'Development', 4, '2026-12-31', $6, $7, $8, $9) RETURNING id`,
      [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, `Escalation task ${seq}`, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
    );
    return res[0].id as number;
  };
  // Submitted while tracking is off (no tracked-submission checks needed here).
  const submitted = async () => {
    await setTracking(false);
    const id = await newTask();
    await submit(id);
    await setTracking(true);
    return id;
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_qa_review_artifacts, task_qa_review_qa_artifacts, performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, user_notifications, audit_logs RESTART IDENTITY CASCADE`,
    );
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

  it('tracking off: no reason needed, none stored (as before)', async () => {
    const id = await newTask();
    await submit(id);
    await escalate(id).expect(200);
    expect(await round(id)).toMatchObject({ status: 'escalated', escalationReasonCode: null, escalationAvoidable: null });
    expect((await get(f.users.qaB, `/tasks/${id}/qa-intake`).expect(200)).body.escalationReasons).toEqual([]);
  });

  it('tracking on: the reasons come with the task, and one must be picked', async () => {
    const id = await submitted();
    expect((await get(f.users.qaB, `/tasks/${id}/qa-intake`).expect(200)).body.escalationReasons).toEqual(DEFAULT_ESCALATION_REASONS);
    await escalate(id).expect(400);
    await escalate(id, { reasonCode: 'nonsense' }).expect(400);
    await escalate(id, { reasonCode: 'developer_unresponsive' }).expect(200);
    expect(await round(id)).toMatchObject({ escalationReasonCode: 'developer_unresponsive', escalationAvoidable: true });
    const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'task_qa_escalated' AND "entityId" = $1`, [id]);
    expect(JSON.parse(audit.details)).toMatchObject({ reasonCode: 'developer_unresponsive', avoidable: true });
  });

  it('settings: the list is editable, new reasons get a code, past rounds keep their flag', async () => {
    const list = DEFAULT_ESCALATION_REASONS.map((r) => (r.code === 'developer_unresponsive' ? { ...r, avoidable: false } : r));
    await patch(f.users.pm, '/performance-tracking/settings', { escalationReasons: [] }).expect(400);
    await patch(f.users.pm, '/performance-tracking/settings', { escalationReasons: [...list, { label: 'Other', avoidable: true }] }).expect(400);
    const { body } = await patch(f.users.pm, '/performance-tracking/settings', { escalationReasons: [...list, { label: 'Design not approved', avoidable: false }] }).expect(200);
    expect(body.settings.escalationReasons.at(-1)).toEqual({ code: 'design_not_approved', label: 'Design not approved', avoidable: false });
    const [r] = await ds.query(`SELECT "escalationAvoidable" FROM task_qa_reviews WHERE "escalationReasonCode" = 'developer_unresponsive'`);
    expect(r.escalationAvoidable).toBe(true);
  });

  it('the nightly run: O4 = avoidable escalations per 10 QA rounds of the submitter', async () => {
    const id = await submitted();
    await escalate(id, { reasonCode: 'requirement_unclear' }).expect(200);
    await ds.query(`UPDATE projects SET "performanceTrackingSince" = now() - interval '10 days' WHERE id = $1`, [f.projects.pA]);
    expect((await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' })).status).toBe('done');
    const [row] = await ds.query(`SELECT value, numerator, denominator, details FROM performance_metric_snapshots WHERE metric = 'O4' AND "userId" = $1`, [f.users.devA.id]);
    // 3 escalated rounds in the window (1 before tracking had a reason), 1 avoidable.
    expect(row).toMatchObject({ numerator: 1, denominator: 3 });
    expect(Number(row.value)).toBeCloseTo(3.33, 2);
    expect(row.details.byReason).toEqual({ none: 1, developer_unresponsive: 1, requirement_unclear: 1 });
  });
});
