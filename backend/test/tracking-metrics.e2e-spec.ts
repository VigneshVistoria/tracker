import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';
import { TRACKING_METRICS } from '../src/performance-tracking/metrics/tracking-metrics';
import { dateInZone } from '../src/team-settings/time-zone';

// Performance Tracking B2 (2026-10-30): the nightly metrics run. Only
// projects with tracking ON get rows; the first baselineDays after go-live
// are 'baseline', then 'scoring'; running twice for the same night
// replaces that night's rows (never duplicates); a run already going makes
// the next one 'skipped'; "Recalculate now" is Admin only.
describe('Performance Tracking metrics run (B2, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let service: TrackingMetricsService;
  const today = () => dateInZone(new Date(), 'Africa/Addis_Ababa');

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const setTracking = (projectId: number, enabled: boolean) => patch(f.users.pm, `/performance-tracking/projects/${projectId}`, { enabled }).expect(200);
  const rowsFor = (projectId: number, date = today()) =>
    ds.query(`SELECT * FROM performance_metric_snapshots WHERE "projectId" = $1 AND "snapshotDate" = $2 ORDER BY "userId", metric`, [projectId, date]);
  const newTask = async (projectId: number, title: string) =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "dueDate")
         VALUES ($1, $2, 'Project', $3, 'Medical Claim', $4, 'Build', $5, 'x', 'Development', $6, $7, $8, $9, CURRENT_DATE) RETURNING id`,
        [f.tenants.t1, projectId, f.modules.mA, phaseId, title, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    service = app.get(TrackingMetricsService);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_status_events, task_commitment_events, task_flags, task_chases, task_progress_notes,
                performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, audit_logs RESTART IDENTITY CASCADE`,
    );
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    await newTask(f.projects.pA, 'Tracked task');
    await newTask(f.projects.pB, 'Untracked task');
    await setTracking(f.projects.pA, false);
    await setTracking(f.projects.pB, false);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('with every project OFF a run writes nothing but is logged', async () => {
    const result = await service.runTenant(f.tenants.t1, { trigger: 'manual' });
    expect(result).toMatchObject({ status: 'done', projects: 0, rowsWritten: 0, snapshotDate: today() });
    const runs = await ds.query(`SELECT * FROM performance_metric_runs`);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'done', trigger: 'manual' });
  });

  it('a tracked project gets one row per metric per person, marked Baseline; untracked gets none', async () => {
    await setTracking(f.projects.pA, true);
    const result = await service.runTenant(f.tenants.t1, { trigger: 'nightly', snapshotDate: today() });
    expect(result).toMatchObject({ status: 'done', projects: 1 });
    const rows = await rowsFor(f.projects.pA);
    expect(rows.length).toBe(TRACKING_METRICS.length);
    expect(new Set(rows.map((r: any) => r.userId))).toEqual(new Set([f.users.devA.id]));
    expect(new Set(rows.map((r: any) => r.phase))).toEqual(new Set(['baseline']));
    expect(await rowsFor(f.projects.pB)).toHaveLength(0);
    expect(result.rowsWritten).toBe(rows.length);
  });

  it('running twice for the same night replaces the rows - no duplicates', async () => {
    const before = await rowsFor(f.projects.pA);
    const second = await service.runTenant(f.tenants.t1, { trigger: 'nightly', snapshotDate: today() });
    const after = await rowsFor(f.projects.pA);
    expect(after.length).toBe(before.length);
    expect(new Set(after.map((r: any) => r.runId))).toEqual(new Set([second.runId]));
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM performance_metric_snapshots`);
    expect(n).toBe(before.length);
  });

  it('after the baseline the rows are Scoring', async () => {
    await ds.query(`UPDATE projects SET "performanceTrackingSince" = now() - interval '40 days' WHERE id = $1`, [f.projects.pA]);
    await service.runTenant(f.tenants.t1, { trigger: 'manual' });
    const rows = await rowsFor(f.projects.pA);
    expect(new Set(rows.map((r: any) => r.phase))).toEqual(new Set(['scoring']));
    // The window never reaches before go-live: 28 days back here.
    expect(rows[0].windowFrom).not.toBe(today());
  });

  it('a night before go-live has nothing to measure', async () => {
    await ds.query(`UPDATE projects SET "performanceTrackingSince" = now() WHERE id = $1`, [f.projects.pA]);
    const result = await service.runTenant(f.tenants.t1, { trigger: 'manual', snapshotDate: '2026-01-05' });
    expect(result).toMatchObject({ status: 'done', projects: 0 });
  });

  it('switching a project off removes its rows for that night on the next run', async () => {
    expect((await rowsFor(f.projects.pA)).length).toBeGreaterThan(0);
    await setTracking(f.projects.pA, false);
    await service.runTenant(f.tenants.t1, { trigger: 'manual' });
    expect(await rowsFor(f.projects.pA)).toHaveLength(0);
    await setTracking(f.projects.pA, true);
  });

  it('a run already going makes the next one skip', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.query(`SELECT pg_advisory_lock(774411, $1)`, [f.tenants.t1]);
    try {
      const result = await service.runTenant(f.tenants.t1, { trigger: 'nightly' });
      expect(result.status).toBe('skipped');
    } finally {
      await runner.query(`SELECT pg_advisory_unlock(774411, $1)`, [f.tenants.t1]);
      await runner.release();
    }
    expect((await service.runTenant(f.tenants.t1, { trigger: 'nightly' })).status).toBe('done');
  });

  it('a run stuck in running for hours is marked failed', async () => {
    await ds.query(
      `INSERT INTO performance_metric_runs ("tenantId", "snapshotDate", "trigger", "status", "startedAt") VALUES ($1, CURRENT_DATE, 'nightly', 'running', now() - interval '7 hours')`,
      [f.tenants.t1],
    );
    await service.runTenant(f.tenants.t1, { trigger: 'manual' });
    const stuck = await ds.query(`SELECT * FROM performance_metric_runs WHERE "startedAt" < now() - interval '6 hours'`);
    expect(stuck[0]).toMatchObject({ status: 'failed' });
  });

  it('Recalculate now: Admin only; no future days; runs and rows readable by Admin/PM', async () => {
    await post(f.users.pm, '/performance-tracking/recalculate').expect(403);
    await post(f.users.devA, '/performance-tracking/recalculate').expect(403);
    await post(f.users.admin, '/performance-tracking/recalculate', { snapshotDate: '2999-01-01' }).expect(400);
    await post(f.users.admin, '/performance-tracking/recalculate', { snapshotDate: 'yesterday' }).expect(400);
    const body = (await post(f.users.admin, '/performance-tracking/recalculate').expect(201)).body;
    expect(body).toMatchObject({ status: 'done', snapshotDate: today() });
    const runs = (await get(f.users.pm, '/performance-tracking/runs').expect(200)).body;
    expect(runs[0]).toMatchObject({ id: body.runId, trigger: 'manual', triggeredByUserId: f.users.admin.id });
    const snap = (await get(f.users.pm, `/performance-tracking/snapshots?projectId=${f.projects.pA}`).expect(200)).body;
    expect(snap.snapshotDate).toBe(today());
    expect(snap.rows.length).toBe(TRACKING_METRICS.length);
    await get(f.users.devA, '/performance-tracking/snapshots').expect(403);
    await get(f.users.pm, '/performance-tracking/snapshots?date=31-10-2026').expect(400);
  });
});
