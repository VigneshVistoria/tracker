import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';
import { dateInZone } from '../src/team-settings/time-zone';

// GitHub pilot rule (2026-11-20): setting "Count GitHub releases in scores"
// (countGithubReleases, default OFF, audited). While off, P1/P2 and Q4 leave
// out a release GitHub created, a "released by" GitHub filled in on a
// manual release and a release task GitHub added (no addedByUserId).
describe('Performance Tracking: GitHub releases in scores (pilot rule, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let service: TrackingMetricsService;
  let manualTask: number;
  let githubTask: number;
  const today = () => dateInZone(new Date(), 'Africa/Addis_Ababa');

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const row = async (metric: string) =>
    (
      await ds.query(`SELECT * FROM performance_metric_snapshots WHERE "projectId" = $1 AND "snapshotDate" = $2 AND "userId" = $3 AND metric = $4`, [
        f.projects.pA,
        today(),
        f.users.devA.id,
        metric,
      ])
    )[0];
  const release = async (version: string, source: string, releasedBy: number | null, githubFilled: string[]) =>
    (
      await ds.query(
        `INSERT INTO releases ("tenantId", "projectId", "projectName", "appName", version, "releaseDate", "releasedByUserId", source, "githubFilled")
         VALUES ($1, $2, 'Project A', 'App', $3, CURRENT_DATE - 1, $4, $5, $6::jsonb) RETURNING id`,
        [f.tenants.t1, f.projects.pA, version, releasedBy, source, JSON.stringify(githubFilled)],
      )
    )[0].id as number;
  const item = (releaseId: number, taskId: number, addedBy: number | null) =>
    ds.query(`INSERT INTO release_items ("tenantId", "releaseId", "taskId", "taskTitle", "addedByUserId") VALUES ($1, $2, $3, 'x', $4)`, [
      f.tenants.t1,
      releaseId,
      taskId,
      addedBy,
    ]);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    service = app.get(TrackingMetricsService);
    await ds.query(
      `TRUNCATE project_tasks, releases, release_items, task_qa_reviews, task_status_events, performance_metric_snapshots, performance_metric_runs,
                performance_tracking_settings, audit_logs RESTART IDENTITY CASCADE`,
    );
    const phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    const newTask = async (title: string) =>
      (
        await ds.query(
          `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "dueDate")
           VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', $5, 'x', 'Development', $6, $7, $8, $9, CURRENT_DATE) RETURNING id`,
          [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, title, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
        )
      )[0].id as number;
    manualTask = await newTask('Released by hand');
    githubTask = await newTask('Added by GitHub');
    await patch(f.users.pm, `/performance-tracking/projects/${f.projects.pA}`, { enabled: true }).expect(200);
    await patch(f.users.pm, `/performance-tracking/projects/${f.projects.pB}`, { enabled: false }).expect(200);
    await ds.query(`UPDATE projects SET "performanceTrackingSince" = now() - interval '40 days' WHERE id = $1`, [f.projects.pA]);

    // Manual release by devA, with one task added by a person and one added by GitHub.
    const manual = await release('1.0.0', 'manual', f.users.devA.id, ['items']);
    await item(manual, manualTask, f.users.pm.id);
    await item(manual, githubTask, null);
    // A release GitHub created, and a manual one whose "released by" GitHub filled.
    await release('1.1.0', 'github', f.users.devA.id, ['releasedByUserId']);
    await release('1.2.0', 'manual', f.users.devA.id, ['releasedByUserId']);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('defaults to OFF: P1/P2 count only the manual release, Q4 only the task a person added', async () => {
    const settings = (await http().get('/performance-tracking/settings').set(auth(f.users.admin)).expect(200)).body.settings;
    expect(settings.countGithubReleases).toBe(false);
    await service.runTenant(f.tenants.t1, { trigger: 'manual', snapshotDate: today() });
    expect((await row('P1')).sample).toBe(1);
    expect((await row('P2')).sample).toBe(1);
    const q4 = await row('Q4');
    expect(q4.details.releasedTaskIds).toEqual([manualTask]);
  });

  it('switched ON (audited): GitHub releases, tasks and "released by" count', async () => {
    await patch(f.users.admin, '/performance-tracking/settings', { countGithubReleases: true }).expect(200);
    const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE "entityType" = 'PerformanceTrackingSettings' ORDER BY id DESC LIMIT 1`);
    const details = typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details;
    expect(details.before.countGithubReleases).toBe(false);
    expect(details.after.countGithubReleases).toBe(true);
    await service.runTenant(f.tenants.t1, { trigger: 'manual', snapshotDate: today() });
    expect((await row('P1')).sample).toBe(3);
    expect((await row('P2')).sample).toBe(3);
    expect([...(await row('Q4')).details.releasedTaskIds].sort()).toEqual([manualTask, githubTask].sort());
  });

  it('switched back OFF: back to the manual data only', async () => {
    await patch(f.users.admin, '/performance-tracking/settings', { countGithubReleases: false }).expect(200);
    await service.runTenant(f.tenants.t1, { trigger: 'manual', snapshotDate: today() });
    expect((await row('P1')).sample).toBe(1);
    expect((await row('Q4')).details.releasedTaskIds).toEqual([manualTask]);
  });
});
