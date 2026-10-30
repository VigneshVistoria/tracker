import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';

// Performance Tracking P3/P4 (2026-10-30): security findings recorded by
// hand - who records, fixes, verifies and accepts the risk; the SLA due
// day; the owner's in-app notifications; the nightly P3/P4 rows.
describe('Security findings (Performance Tracking P3/P4, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser) => http().get('/security-findings').set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const today = () => new Date().toISOString().slice(0, 10);
  // The day in the team zone (default East Africa Time) - what assignedOn uses.
  const teamToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Addis_Ababa' });
  const finding = async (id: number) => (
      await ds.query(
        `SELECT *, "foundOn"::text AS "foundOn", "dueOn"::text AS "dueOn", "assignedOn"::text AS "assignedOn", "ownerDueOn"::text AS "ownerDueOn" FROM security_findings WHERE id = $1`,
        [id],
      )
    )[0];
  const create = (u: FixtureUser, extra: any = {}) =>
    post(u, '/security-findings', { projectId: f.projects.pA, title: 'SQL injection in claim search', severity: 'high', ownerUserId: f.users.devA.id, foundOn: today(), ...extra });
  const notified = async (userId: number, type: string) => {
    for (let i = 0; i < 40; i++) {
      if ((await ds.query(`SELECT 1 FROM user_notifications WHERE "userId" = $1 AND type = $2`, [userId, type])).length) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const newId = async () => (await ds.query(`SELECT max(id) AS id FROM security_findings`))[0].id as number;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE security_findings, performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, user_notifications, audit_logs RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('needs a tracked project', async () => {
    await ds.query(`UPDATE projects SET "performanceTrackingEnabled" = false WHERE id = $1`, [f.projects.pA]);
    await create(f.users.qaB).expect(400);
    await ds.query(`UPDATE projects SET "performanceTrackingEnabled" = true, "performanceTrackingSince" = now() - interval '10 days' WHERE id = $1`, [f.projects.pA]);
  });

  it('QA, PM and Admin record; developers and executives do not; the owner must be a Developer, Designer or DevOps', async () => {
    await create(f.users.devA).expect(403);
    await create(f.users.exec).expect(403);
    await create(f.users.qaB, { ownerUserId: f.users.qaB.id }).expect(400);
    await create(f.users.qaB, { foundOn: '2999-01-01' }).expect(400);
    const { body } = await create(f.users.qaB).expect(201);
    const row = body.findings[0];
    expect(row).toMatchObject({ severity: 'high', status: 'open', ownerUserId: f.users.devA.id, canVerify: false });
    // High = 5 working days after the found day.
    expect(row.dueOn > row.foundOn).toBe(true);
    expect(await notified(f.users.devA.id, 'security.findingAssigned')).toBe(true);
  });

  it('who sees what: the owner their own, clients nothing', async () => {
    expect((await get(f.users.devA).expect(200)).body.findings).toHaveLength(1);
    expect((await get(f.users.devNone).expect(200)).body.findings).toHaveLength(0);
    expect((await get(f.users.exec).expect(200)).body.findings).toHaveLength(1);
    await get(f.users.clientA).expect(403);
  });

  it('owner submits a fix, never verifies it; a failed verification reopens it and tells the owner; then it passes', async () => {
    const id = await newId();
    await post(f.users.devNone, `/security-findings/${id}/fix`, { note: 'Parameterised the query' }).expect(403);
    await post(f.users.devA, `/security-findings/${id}/fix`, { note: 'short' }).expect(400);
    await post(f.users.devA, `/security-findings/${id}/fix`, { note: 'Parameterised the query' }).expect(201);
    await post(f.users.devA, `/security-findings/${id}/verify`, { passed: true }).expect(403);
    await post(f.users.qaB, `/security-findings/${id}/verify`, { passed: false }).expect(400);
    await post(f.users.qaB, `/security-findings/${id}/verify`, { passed: false, note: 'Still injectable via sort field' }).expect(201);
    expect(await finding(id)).toMatchObject({ status: 'open', verifyAttempts: 1, firstVerifyResult: 'failed' });
    expect(await notified(f.users.devA.id, 'security.fixFailed')).toBe(true);
    await post(f.users.devA, `/security-findings/${id}/fix`, { note: 'Whitelisted the sort field too' }).expect(201);
    await post(f.users.pm, `/security-findings/${id}/verify`, { passed: true }).expect(201);
    const done = await finding(id);
    expect(done).toMatchObject({ status: 'verified', verifyAttempts: 2, firstVerifyResult: 'failed', verifiedByUserId: f.users.pm.id });
    expect(done.fixedAt).toEqual(done.fixSubmittedAt);
    const actions = (await ds.query(`SELECT action FROM audit_logs WHERE "entityType" = 'SecurityFinding' AND "entityId" = $1 ORDER BY id`, [id])).map((r: any) => r.action);
    expect(actions).toEqual([
      'security_finding_created',
      'security_finding_fix_submitted',
      'security_finding_verified',
      'security_finding_fix_submitted',
      'security_finding_verified',
    ]);
  });

  it('only PM/Admin accept the risk, with a reason; severity change moves the due day', async () => {
    await create(f.users.qaB, { severity: 'low', title: 'Verbose error page' }).expect(201);
    const id = await newId();
    const low = await finding(id);
    await http().patch(`/security-findings/${id}`).set(auth(f.users.qaB)).send({ severity: 'critical' }).expect(200);
    const critical = await finding(id);
    expect(critical.dueOn < low.dueOn).toBe(true);
    await post(f.users.qaB, `/security-findings/${id}/accept-risk`, { reason: 'Internal only page' }).expect(403);
    await post(f.users.pm, `/security-findings/${id}/accept-risk`, { reason: 'short' }).expect(400);
    await post(f.users.pm, `/security-findings/${id}/accept-risk`, { reason: 'Internal only page, removed next release' }).expect(201);
    expect(await finding(id)).toMatchObject({ status: 'risk_accepted' });
    await http().patch(`/security-findings/${id}`).set(auth(f.users.qaB)).send({ title: 'Changed' }).expect(400);
  });

  it('reassigning restarts the owner due day from today; the found-date SLA stays', async () => {
    await create(f.users.qaB, { title: 'Weak password policy', severity: 'medium', foundOn: '2026-01-05' }).expect(201);
    const id = await newId();
    const before = await finding(id);
    expect(before.dueOn).toBe('2026-01-19');
    expect(before.assignedOn).toBe(teamToday());
    await ds.query(`UPDATE security_findings SET "assignedOn" = '2026-01-05', "ownerDueOn" = '2026-01-19' WHERE id = $1`, [id]);
    expect((await get(f.users.qaB).expect(200)).body.findings.find((x: any) => x.id === id)).toMatchObject({ slaMissed: true, ownerBreached: true });
    await http().patch(`/security-findings/${id}`).set(auth(f.users.qaB)).send({ ownerUserId: f.users.devNone.id }).expect(200);
    const after = await finding(id);
    expect(after).toMatchObject({ ownerUserId: f.users.devNone.id, dueOn: '2026-01-19' });
    expect(after.assignedOn).toBe(teamToday());
    expect(after.ownerDueOn > teamToday()).toBe(true);
    expect((await get(f.users.qaB).expect(200)).body.findings.find((x: any) => x.id === id)).toMatchObject({ slaMissed: true, ownerBreached: false });
    await post(f.users.pm, `/security-findings/${id}/accept-risk`, { reason: 'Policy change planned for Q1' }).expect(201);
    expect((await get(f.users.qaB).expect(200)).body.findings.find((x: any) => x.id === id)).toMatchObject({ ownerBreached: null });
  });

  it('settings: SLA days and roles are editable and checked', async () => {
    const set = (body: any) => http().patch('/performance-tracking/settings').set(auth(f.users.pm)).send(body);
    await set({ securitySlaDays: { critical: 0, high: 5, medium: 10, low: 20 } }).expect(400);
    await set({ securitySlaDays: { critical: 1, high: 5, medium: 10 } }).expect(400);
    await set({ securityRoles: ['developer'] }).expect(400);
    const { body } = await set({ securitySlaDays: { critical: 1, high: 3, medium: 10, low: 20 }, securityRoles: ['admin', 'program_manager'] }).expect(200);
    expect(body.settings).toMatchObject({ securitySlaDays: { critical: 1, high: 3 }, securityRoles: ['admin', 'program_manager'] });
    await create(f.users.qaB).expect(403);
  });

  it('the nightly run: P3 (first-time pass) and P4 (SLA breaches) for the owner', async () => {
    // A finding found long ago and still open: breached.
    await ds.query(
      `INSERT INTO security_findings ("tenantId", "projectId", title, severity, "ownerUserId", "foundOn", "dueOn", "assignedOn", "ownerDueOn", status, "createdByUserId")
       VALUES ($1, $2, 'Old open finding', 'medium', $3, current_date - 9, current_date - 2, current_date - 9, current_date - 2, 'open', $4)`,
      [f.tenants.t1, f.projects.pA, f.users.devA.id, f.users.qaB.id],
    );
    expect((await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' })).status).toBe('done');
    const rows = await ds.query(`SELECT metric, value, numerator, denominator, "enoughData" FROM performance_metric_snapshots WHERE metric IN ('P3', 'P4') AND "userId" = $1 ORDER BY metric`, [f.users.devA.id]);
    expect(rows.map((r: any) => ({ ...r, value: r.value === null ? null : Number(r.value) }))).toEqual([
      { metric: 'P3', value: 0, numerator: 0, denominator: 1, enoughData: false },
      { metric: 'P4', value: 1, numerator: 1, denominator: 1, enoughData: true },
    ]);
  });
});
