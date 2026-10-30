import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { ESCAPED_DEFECT_AUDIT } from '../src/tasks/escaped-defect';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';
import { dateInZone } from '../src/team-settings/time-zone';
import { addCalendarDays } from '../src/performance-metrics/working-days';

// Performance Tracking Q4 (2026-10-30): "Found in production" on a defect
// (QA/PM/Admin, tracking ON, audited), release date from the Release Log,
// and the nightly run's Q4 row.
describe('Escaped defects (Performance Tracking Q4, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let source: number;
  let unreleased: number;
  let defect: number;
  const today = dateInZone(new Date(), 'Africa/Addis_Ababa');
  const released = addCalendarDays(today, -2);

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const setTracking = (projectId: number, enabled: boolean) => patch(f.users.pm, `/performance-tracking/projects/${projectId}`, { enabled }).expect(200);
  const newTask = async (title: string, extra: { isDefect?: boolean; projectId?: number; creator?: FixtureUser } = {}) =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "isDefect")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', $5, 'x', 'Development', $6, $7, $8, $9, $10) RETURNING id`,
        [
          f.tenants.t1,
          extra.projectId ?? f.projects.pA,
          f.modules.mA,
          phaseId,
          title,
          f.users.devA.id,
          f.users.devA.email,
          (extra.creator ?? f.users.pm).id,
          (extra.creator ?? f.users.pm).email,
          !!extra.isDefect,
        ],
      )
    )[0].id as number;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, releases, release_items, performance_metric_snapshots, performance_metric_runs,
                performance_tracking_settings, audit_logs RESTART IDENTITY CASCADE`,
    );
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    source = await newTask('Refund flow');
    unreleased = await newTask('Not released yet');
    defect = await newTask('Refund fails in production', { isDefect: true, creator: f.users.qaB });
    // devA's submission of the source task passed QA.
    await ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", "resolution", "submittedByUserId", "submittedByEmail", "submittedAt", status, "reviewType", "reviewedAt")
       VALUES ($1, $2, 1, 'Fixed', $3, $4, now() - interval '3 days', 'approved', 'qa', now() - interval '3 days')`,
      [f.tenants.t1, source, f.users.devA.id, f.users.devA.email],
    );
    const releaseId = (
      await ds.query(
        `INSERT INTO releases ("tenantId", "projectId", "projectName", "appName", version, "releaseDate") VALUES ($1, $2, 'Project A', 'Claims', '1.0', $3) RETURNING id`,
        [f.tenants.t1, f.projects.pA, released],
      )
    )[0].id;
    await ds.query(`INSERT INTO release_items ("tenantId", "releaseId", "taskId", "taskTitle") VALUES ($1, $2, $3, 'Refund flow')`, [f.tenants.t1, releaseId, source]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows nothing and refuses changes while tracking is off', async () => {
    const { body } = await get(f.users.qaB, `/tasks/${defect}/escaped-defect`).expect(200);
    expect(body).toMatchObject({ isDefect: true, trackingOn: false, canEdit: false, foundInProduction: false });
    await patch(f.users.qaB, `/tasks/${defect}/escaped-defect`, { foundInProduction: true, escapedFromTaskId: source }).expect(400);
    await setTracking(f.projects.pA, true);
  });

  it('QA, PM and Admin only - never the developer', async () => {
    expect((await get(f.users.devA, `/tasks/${defect}/escaped-defect`).expect(200)).body.canEdit).toBe(false);
    await patch(f.users.devA, `/tasks/${defect}/escaped-defect`, { foundInProduction: true, escapedFromTaskId: source }).expect(403);
    expect((await get(f.users.qaB, `/tasks/${defect}/escaped-defect`).expect(200)).body.canEdit).toBe(true);
  });

  it('refuses a task, itself, a future date, and a source with no Release Log date and none entered', async () => {
    await patch(f.users.pm, `/tasks/${source}/escaped-defect`, { foundInProduction: true }).expect(400);
    await patch(f.users.pm, `/tasks/${defect}/escaped-defect`, { foundInProduction: true, escapedFromTaskId: defect, productionReleaseDate: released }).expect(400);
    await patch(f.users.pm, `/tasks/${defect}/escaped-defect`, { foundInProduction: true, escapedFromTaskId: source, productionReleaseDate: addCalendarDays(today, 3) }).expect(400);
    const res = await patch(f.users.pm, `/tasks/${defect}/escaped-defect`, { foundInProduction: true, escapedFromTaskId: unreleased }).expect(400);
    expect(res.body.message).toMatch(/Release Log/);
    expect(await ds.query(`SELECT 1 FROM audit_logs WHERE action = $1`, [ESCAPED_DEFECT_AUDIT.MARKED])).toHaveLength(0);
  });

  it('marks it, taking the release date from the Release Log, audited', async () => {
    const { body } = await patch(f.users.qaB, `/tasks/${defect}/escaped-defect`, { foundInProduction: true, escapedFromTaskId: source }).expect(200);
    expect(body).toMatchObject({ foundInProduction: true, escapedFromTaskId: source, escapedFromTaskTitle: 'Refund flow', productionReleaseDate: released, markedByName: 'Name qaB' });
    const audits = await ds.query(`SELECT details FROM audit_logs WHERE action = $1`, [ESCAPED_DEFECT_AUDIT.MARKED]);
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].details)).toMatchObject({ before: { foundInProduction: false }, after: { foundInProduction: true, escapedFromTaskId: source, productionReleaseDate: released } });
    // Saving the same again changes nothing and logs nothing.
    await patch(f.users.qaB, `/tasks/${defect}/escaped-defect`, { foundInProduction: true, escapedFromTaskId: source }).expect(200);
    expect(await ds.query(`SELECT 1 FROM audit_logs WHERE action = $1`, [ESCAPED_DEFECT_AUDIT.MARKED])).toHaveLength(1);
  });

  it('the nightly run charges it to whoever passed the source task, per 10 tasks released', async () => {
    await ds.query(`UPDATE projects SET "performanceTrackingSince" = now() - interval '10 days' WHERE id = $1`, [f.projects.pA]);
    const result = await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' });
    expect(result.status).toBe('done');
    const [row] = await ds.query(`SELECT value, numerator, denominator, details FROM performance_metric_snapshots WHERE metric = 'Q4' AND "userId" = $1`, [f.users.devA.id]);
    expect(row).toMatchObject({ numerator: 1, denominator: 1 });
    expect(Number(row.value)).toBe(10);
    expect(row.details.escaped).toEqual([{ defectId: defect, sourceTaskId: source, releaseDate: released, foundOn: today }]);
  });

  it('a PM can remove the mark', async () => {
    const { body } = await patch(f.users.pm, `/tasks/${defect}/escaped-defect`, { foundInProduction: false }).expect(200);
    expect(body).toMatchObject({ foundInProduction: false, escapedFromTaskId: null, productionReleaseDate: null, markedByName: null });
    expect(await ds.query(`SELECT 1 FROM audit_logs WHERE action = $1`, [ESCAPED_DEFECT_AUDIT.MARKED])).toHaveLength(2);
  });
});
