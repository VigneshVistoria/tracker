import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';

// Performance Tracking P1/P2 (2026-10-30): who released, the staging
// sign-off and the change ticket on a Release Log entry (PM only, as the
// Release Log is); the nightly P1/P2 rows.
describe('Release path (Performance Tracking P1/P2, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let releaseId: number;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const patch = (u: FixtureUser, body: any) => http().patch(`/releases/${releaseId}`).set(auth(u)).send(body);
  const today = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE releases, release_items, performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, audit_logs RESTART IDENTITY CASCADE`);
    releaseId = (
      await ds.query(
        `INSERT INTO releases ("tenantId", "projectId", "projectName", "appName", version, "releaseDate") VALUES ($1, $2, 'Project A', 'Claims', '2.0', $3) RETURNING id`,
        [f.tenants.t1, f.projects.pA, today()],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('only the PM can record it', async () => {
    await patch(f.users.admin, { releasedByUserId: f.users.devA.id }).expect(403);
    await patch(f.users.devA, { releasedByUserId: f.users.devA.id }).expect(403);
  });

  it('checks who released, who signed off, and that the sign-off is complete', async () => {
    await patch(f.users.pm, { releasedByUserId: f.users.qaB.id }).expect(400);
    await patch(f.users.pm, { releasedByUserId: f.users.pmT2.id }).expect(400);
    await patch(f.users.pm, { releasedByUserId: f.users.devA.id, stagingSignedOffOn: today() }).expect(400);
    await patch(f.users.pm, { releasedByUserId: f.users.devA.id, stagingSignedOffOn: today(), stagingSignedOffByUserId: f.users.devA.id }).expect(400);
    await patch(f.users.pm, { releasedByUserId: f.users.devA.id, stagingSignedOffOn: today(), stagingSignedOffByUserId: f.users.clientA.id }).expect(400);
    const { body } = await patch(f.users.pm, {
      releasedByUserId: f.users.devA.id,
      stagingSignedOffOn: today(),
      stagingSignedOffByUserId: f.users.qaB.id,
      changeTicketRef: '  CHG-42 ',
    }).expect(200);
    expect(body).toMatchObject({ releasedByUserId: f.users.devA.id, stagingSignedOffOn: today(), stagingSignedOffByUserId: f.users.qaB.id, changeTicketRef: 'CHG-42' });
    const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'release_updated' AND "entityId" = $1 ORDER BY id DESC`, [releaseId]);
    expect(JSON.parse(audit.details).updated).toMatchObject({ changeTicketRef: '  CHG-42 ' });
  });

  it('the database refuses half a sign-off', async () => {
    await expect(ds.query(`UPDATE releases SET "stagingSignedOffByUserId" = NULL WHERE id = $1`, [releaseId])).rejects.toThrow(/CHK_releases_staging_sign_off/);
  });

  it('the nightly run: P1 and P2 for the person who released, with their own window and minimum', async () => {
    await ds.query(`UPDATE projects SET "performanceTrackingEnabled" = true, "performanceTrackingSince" = now() - interval '10 days' WHERE id = $1`, [f.projects.pA]);
    expect((await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' })).status).toBe('done');
    const rows = await ds.query(`SELECT metric, value, numerator, denominator, "enoughData" FROM performance_metric_snapshots WHERE metric IN ('P1', 'P2') AND "userId" = $1 ORDER BY metric`, [f.users.devA.id]);
    expect(rows.map((r: any) => ({ ...r, value: Number(r.value) }))).toEqual([
      { metric: 'P1', value: 100, numerator: 1, denominator: 1, enoughData: false },
      { metric: 'P2', value: 100, numerator: 1, denominator: 1, enoughData: false },
    ]);
    // 1 release is below the default minimum of 3; the settings are editable.
    const { body } = await http().patch('/performance-tracking/settings').set(auth(f.users.pm)).send({ releaseWindowDays: 120, releaseMinSample: 1 }).expect(200);
    expect(body.settings).toMatchObject({ releaseWindowDays: 120, releaseMinSample: 1 });
    await http().patch('/performance-tracking/settings').set(auth(f.users.pm)).send({ releaseWindowDays: 10 }).expect(400);
    await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' });
    const [p1] = await ds.query(`SELECT "enoughData", details FROM performance_metric_snapshots WHERE metric = 'P1' AND "userId" = $1`, [f.users.devA.id]);
    expect(p1).toMatchObject({ enoughData: true, details: { windowDays: 120 } });
  });
});
