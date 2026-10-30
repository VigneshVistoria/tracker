import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';

// Performance Tracking L3-L5 (2026-10-30): client priority tier and UAT
// results on a task, satisfaction on a release - Program Manager only, on
// tracked projects, audited; the settings; the nightly L4/L5 rows.
describe('Client measures (Performance Tracking L3-L5, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let taskId: number;
  let releaseId: number;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const send = (u: FixtureUser, method: 'post' | 'patch' | 'put', url: string, body: any = {}) => http()[method](url).set(auth(u)).send(body);
  const tracking = (on: boolean) => ds.query(`UPDATE projects SET "performanceTrackingEnabled" = $2, "performanceTrackingSince" = now() - interval '10 days' WHERE id = $1`, [f.projects.pA, on]);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_priority_tier_events, task_uat_results, release_satisfaction, releases, release_items, task_qa_reviews, performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, audit_logs RESTART IDENTITY CASCADE`);
    const phaseId = (
      await ds.query(`INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`, [f.tenants.t1, f.projects.pA, f.modules.mA])
    )[0].id;
    taskId = (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "estimatedHours", "dueDate", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', 'Claim refund', 'x', 'Pass', 4, '2026-12-31', $5, $6, $7, $8) RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id;
    releaseId = (
      await ds.query(`INSERT INTO releases ("tenantId", "projectId", "projectName", "appName", version, "releaseDate") VALUES ($1, $2, 'Project A', 'Claims', '3.0', current_date) RETURNING id`, [f.tenants.t1, f.projects.pA])
    )[0].id;
    await ds.query(`INSERT INTO release_items ("tenantId", "releaseId", "taskId", "taskTitle") VALUES ($1, $2, $3, 'Claim refund')`, [f.tenants.t1, releaseId, taskId]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('tracking off: shown as off, nothing can be recorded', async () => {
    await tracking(false);
    expect((await get(f.users.pm, `/tasks/${taskId}/client-measures`).expect(200)).body).toMatchObject({ trackingOn: false, canEdit: false });
    await send(f.users.pm, 'patch', `/tasks/${taskId}/client-priority-tier`, { tier: 1 }).expect(400);
    await tracking(true);
  });

  it('L3 tier: PM only, within the list, audited', async () => {
    await send(f.users.admin, 'patch', `/tasks/${taskId}/client-priority-tier`, { tier: 1 }).expect(403);
    await send(f.users.devA, 'patch', `/tasks/${taskId}/client-priority-tier`, { tier: 1 }).expect(403);
    await send(f.users.pm, 'patch', `/tasks/${taskId}/client-priority-tier`, { tier: 5 }).expect(400);
    const { body } = await send(f.users.pm, 'patch', `/tasks/${taskId}/client-priority-tier`, { tier: 2 }).expect(200);
    expect(body).toMatchObject({ tier: 2, tierLabel: 'High', tiers: ['Critical', 'High', 'Normal', 'Low'] });
    const [a] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'task_client_priority_tier_set'`);
    expect(JSON.parse(a.details)).toMatchObject({ before: null, after: 2, afterLabel: 'High' });
    // Every change is logged with who and when; clearing too.
    await send(f.users.pm, 'patch', `/tasks/${taskId}/client-priority-tier`, { tier: 1 }).expect(200);
    await send(f.users.pm, 'patch', `/tasks/${taskId}/client-priority-tier`, { tier: 1 }).expect(200);
    const after = (await send(f.users.pm, 'patch', `/tasks/${taskId}/client-priority-tier`, { tier: 2 }).expect(200)).body;
    const events = await ds.query(`SELECT tier, "previousTier", "changedByUserId" FROM task_priority_tier_events WHERE "taskId" = $1 ORDER BY id`, [taskId]);
    expect(events).toEqual([
      { tier: 2, previousTier: null, changedByUserId: f.users.pm.id },
      { tier: 1, previousTier: 2, changedByUserId: f.users.pm.id },
      { tier: 2, previousTier: 1, changedByUserId: f.users.pm.id },
    ]);
    expect(after.tierHistory.map((h: any) => [h.previousLabel, h.tierLabel])).toEqual([
      ['Not set', 'High'],
      ['High', 'Critical'],
      ['Critical', 'High'],
    ]);
    // The developer sees it, read-only.
    expect((await get(f.users.devA, `/tasks/${taskId}/client-measures`).expect(200)).body).toMatchObject({ tier: 2, canEdit: false });
  });

  it('settings: tiers can be renamed but not cut below a tier in use; questions are checked', async () => {
    const set = (body: any) => send(f.users.pm, 'patch', '/performance-tracking/settings', body);
    await set({ clientPriorityTiers: ['Urgent'] }).expect(400);
    await set({ clientPriorityTiers: ['P1', 'P1'] }).expect(400);
    await set({ satisfactionQuestions: [] }).expect(400);
    await set({ clientPriorityTiers: ['P1', 'P2', 'P3'] }).expect(200);
    await ds.query(`UPDATE project_tasks SET "clientPriorityTier" = 3 WHERE id = $1`, [taskId]);
    await set({ clientPriorityTiers: ['P1', 'P2'] }).expect(400);
    await ds.query(`UPDATE project_tasks SET "clientPriorityTier" = 2 WHERE id = $1`, [taskId]);
  });

  it('L4 UAT: rounds numbered, a failure needs a note, PM only', async () => {
    await send(f.users.qaB, 'post', `/tasks/${taskId}/uat-results`, { result: 'passed' }).expect(403);
    await send(f.users.pm, 'post', `/tasks/${taskId}/uat-results`, { result: 'failed' }).expect(400);
    await send(f.users.pm, 'post', `/tasks/${taskId}/uat-results`, { result: 'failed', note: 'Refund total wrong for partial claims' }).expect(201);
    const { body } = await send(f.users.pm, 'post', `/tasks/${taskId}/uat-results`, { result: 'passed' }).expect(201);
    expect(body.uatResults.map((r: any) => [r.round, r.result])).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ]);
  });

  it('L5 satisfaction: one response per release, every question 1-5, editable and audited', async () => {
    await get(f.users.admin, `/releases/${releaseId}/satisfaction`).expect(403);
    const empty = (await get(f.users.pm, `/releases/${releaseId}/satisfaction`).expect(200)).body;
    expect(empty).toMatchObject({ questions: ['How satisfied are you with this release?', 'How well did the team understand what you needed?'], response: null, canEdit: true });
    await send(f.users.pm, 'put', `/releases/${releaseId}/satisfaction`, { scores: [5] }).expect(400);
    await send(f.users.pm, 'put', `/releases/${releaseId}/satisfaction`, { scores: [6, 4] }).expect(400);
    await send(f.users.pm, 'put', `/releases/${releaseId}/satisfaction`, { scores: [4, 3], respondent: 'Claims lead' }).expect(200);
    const { body } = await send(f.users.pm, 'put', `/releases/${releaseId}/satisfaction`, { scores: [5, 4], respondent: 'Claims lead' }).expect(200);
    expect(body.response).toMatchObject({ scores: [5, 4], average: 4.5, respondent: 'Claims lead' });
    expect(Number((await ds.query(`SELECT count(*) FROM release_satisfaction`))[0].count)).toBe(1);
    const audits = await ds.query(`SELECT details FROM audit_logs WHERE action = 'release_satisfaction_saved' ORDER BY id`);
    expect(JSON.parse(audits[1].details)).toMatchObject({ before: { scores: [4, 3] }, after: { scores: [5, 4] } });
  });

  it('the nightly run: L4 and L5 for whoever answers for the task', async () => {
    expect((await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' })).status).toBe('done');
    const rows = await ds.query(`SELECT metric, value, numerator, denominator, sample, "enoughData" FROM performance_metric_snapshots WHERE metric IN ('L4', 'L5') AND "userId" = $1 ORDER BY metric`, [f.users.devA.id]);
    expect(rows.map((r: any) => ({ ...r, value: Number(r.value) }))).toEqual([
      { metric: 'L4', value: 0, numerator: 0, denominator: 1, sample: 1, enoughData: false },
      { metric: 'L5', value: 4.5, numerator: null, denominator: null, sample: 1, enoughData: false },
    ]);
  });
});
