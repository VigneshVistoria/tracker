import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { OWN_METRICS_AUDIT } from '../src/performance-tracking/own-metrics-visibility.service';

// Own performance figures for team members (2026-11-11, the user's
// instruction): Developer/Designer/DevOps/QA see no performance figures -
// not even their own - unless an Admin allows it for their role (default
// nobody, audited). Admin/PM/Executive unchanged. Every API refuses (403),
// so nothing is reachable by URL.
describe('Own performance figures - visibility (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const setRoles = (u: FixtureUser, roles: any) => http().patch('/own-metrics-visibility').set(auth(u)).send({ roles });
  // Every API that shows a person's own performance figures.
  const OWN_APIS = (u: FixtureUser) => [
    '/performance-metrics',
    '/performance-tracking/scorecard',
    `/performance-tracking/scorecard/people/${u.id}`,
    '/kpi/me',
    '/performance-dashboard',
  ];

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE audit_logs, performance_tracking_settings RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('default: a Developer and a QA get 403 on every own-figures API, and the app is told not to show the links', async () => {
    for (const url of [...OWN_APIS(f.users.devA), '/tech-reviews']) {
      const res = await get(f.users.devA, url).expect(403);
      expect(res.body.message).toMatch(/not (shown|available)|only see your own|cannot/);
    }
    for (const url of ['/kpi/me', '/performance-dashboard']) await get(f.users.qaB, url).expect(403);
    expect((await get(f.users.devA, '/own-metrics-visibility/me').expect(200)).body).toEqual({ canSeeOwn: false });
    expect((await get(f.users.qaB, '/own-metrics-visibility/me').expect(200)).body).toEqual({ canSeeOwn: false });
    expect((await get(f.users.clientA, '/own-metrics-visibility/me').expect(200)).body).toEqual({ canSeeOwn: false });
  });

  it('default: weekly report and security findings (page and actions) refused for Developer and QA; PM/Admin/Executive keep them', async () => {
    await get(f.users.devA, '/weekly-status').expect(403);
    await http().put('/weekly-status').set(auth(f.users.devA)).send({ week: '2026-11-09', done: 'Finished the refund API and its tests', plan: 'Start the export screen next week' }).expect(403);
    await get(f.users.devA, '/security-findings').expect(403);
    await http().post('/security-findings/1/fix').set(auth(f.users.devA)).send({ note: 'Fixed the header' }).expect(403);
    await get(f.users.qaB, '/security-findings').expect(403);
    await http().post('/security-findings/1/verify').set(auth(f.users.qaB)).send({ passed: true }).expect(403);
    // No project is tracked in this file (these then answer 400) - the point is: not blocked.
    for (const u of [f.users.admin, f.users.pm, f.users.exec]) {
      for (const url of ['/weekly-status', '/security-findings']) expect((await get(u, url)).status).not.toBe(403);
    }
  });

  it('Admin, Program Manager and Executive are unchanged', async () => {
    for (const u of [f.users.admin, f.users.pm, f.users.exec]) {
      expect((await get(u, '/own-metrics-visibility/me').expect(200)).body).toEqual({ canSeeOwn: true });
      for (const url of ['/performance-metrics', '/performance-tracking/scorecard', '/kpi/me', '/performance-dashboard', '/tech-reviews']) await get(u, url).expect(200);
    }
  });

  it('the setting: Admin only, checked, audited with before and after', async () => {
    expect((await get(f.users.admin, '/own-metrics-visibility').expect(200)).body).toEqual({ roles: [], choices: ['developer', 'designer', 'devops', 'qa'] });
    await get(f.users.pm, '/own-metrics-visibility').expect(403);
    await setRoles(f.users.pm, ['developer']).expect(403);
    await setRoles(f.users.devA, ['developer']).expect(403);
    await setRoles(f.users.admin, ['admin']).expect(400);
    await setRoles(f.users.admin, ['client']).expect(400);
    await setRoles(f.users.admin, 'developer').expect(400);
    const res = await setRoles(f.users.admin, ['developer', 'developer']).expect(200);
    expect(res.body.roles).toEqual(['developer']);
    const audit = await ds.query(`SELECT "userId", details FROM audit_logs WHERE action = $1`, [OWN_METRICS_AUDIT]);
    expect(audit).toHaveLength(1);
    expect(audit[0].userId).toBe(f.users.admin.id);
    expect(JSON.parse(audit[0].details)).toEqual({ before: [], after: ['developer'] });
  });

  it('allowed for Developer: own figures only (someone else\'s card is still refused); QA still refused', async () => {
    expect((await get(f.users.devA, '/own-metrics-visibility/me').expect(200)).body).toEqual({ canSeeOwn: true });
    for (const url of [...OWN_APIS(f.users.devA), '/tech-reviews']) await get(f.users.devA, url).expect(200);
    // No project is tracked in this file, so these answer 400 ("not tracked") - the point is: not blocked.
    for (const url of ['/weekly-status', '/security-findings']) expect((await get(f.users.devA, url)).status).not.toBe(403);
    await get(f.users.devA, `/performance-tracking/scorecard/people/${f.users.devNone.id}`).expect(403);
    const own = await get(f.users.devA, '/performance-dashboard').expect(200);
    expect(own.body).not.toHaveProperty('leaderboard');
    await get(f.users.qaB, '/kpi/me').expect(403);
  });

  it('allowed for QA too; switching back off refuses again', async () => {
    await setRoles(f.users.admin, ['developer', 'qa']).expect(200);
    for (const url of ['/kpi/me', '/performance-dashboard']) await get(f.users.qaB, url).expect(200);
    await setRoles(f.users.admin, []).expect(200);
    await get(f.users.devA, '/kpi/me').expect(403);
    await get(f.users.qaB, '/kpi/me').expect(403);
    expect((await ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = $1`, [OWN_METRICS_AUDIT]))[0].n).toBe(3);
  });
});
