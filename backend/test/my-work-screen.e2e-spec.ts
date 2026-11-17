import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { MY_WORK_SCREEN_AUDIT } from '../src/my-work-screen/my-work-screen';

// "New My work screen" setting (2026-11-17): replaces DEV_MY_WORK. Admin/PM
// only, audited, DEFAULT OFF; pilot users get it while it is off; only
// Developer/Designer/DevOps homes ever switch.
describe('My work screen setting (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;

  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => request(app.getHttpServer()).get(url).set(auth(u));
  const put = (u: FixtureUser, body: any) => request(app.getHttpServer()).put('/my-work-screen/settings').set(auth(u)).send(body);
  const onFor = async (u: FixtureUser) => (await get(u, '/my-work-screen/me').expect(200)).body.on;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE team_settings, audit_logs RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('is OFF by default for everyone, with or without a settings row', async () => {
    expect(await onFor(f.users.devA)).toBe(false);
    const body = (await get(f.users.admin, '/my-work-screen/settings').expect(200)).body;
    expect(body.settings).toEqual({ enabled: false, pilotUserIds: [] });
    expect(body.users.map((u: any) => u.id).sort()).toEqual([f.users.devA.id, f.users.devNone.id].sort());
    // A row made by another setting gets the column default - still OFF.
    await ds.query(`INSERT INTO team_settings ("tenantId") VALUES ($1)`, [f.tenants.t1]);
    expect(await onFor(f.users.devA)).toBe(false);
  });

  it('only Admin and Program Manager read or change it', async () => {
    await get(f.users.devA, '/my-work-screen/settings').expect(403);
    await put(f.users.devA, { enabled: true, pilotUserIds: [] }).expect(403);
    await put(f.users.exec, { enabled: true, pilotUserIds: [] }).expect(403);
    await put(f.users.qaB, { enabled: true, pilotUserIds: [] }).expect(403);
    expect(await onFor(f.users.devA)).toBe(false);
  });

  it('pilot users get it while Off; others do not; non-developers never do', async () => {
    await put(f.users.pm, { enabled: false, pilotUserIds: [f.users.devA.id] }).expect(200);
    expect(await onFor(f.users.devA)).toBe(true);
    expect(await onFor(f.users.devNone)).toBe(false);
    await put(f.users.pm, { enabled: false, pilotUserIds: [f.users.qaB.id] }).expect(400);
    await put(f.users.pm, { enabled: false, pilotUserIds: ['x'] }).expect(400);
  });

  it('On for everyone, audited before/after; back Off restores the old screen', async () => {
    await put(f.users.admin, { enabled: true, pilotUserIds: [] }).expect(200);
    expect(await onFor(f.users.devNone)).toBe(true);
    expect(await onFor(f.users.qaB)).toBe(false);
    expect(await onFor(f.users.pm)).toBe(false);
    await put(f.users.admin, { enabled: false, pilotUserIds: [] }).expect(200);
    expect(await onFor(f.users.devA)).toBe(false);
    const rows = await ds.query(`SELECT "userId", details FROM audit_logs WHERE action = $1 ORDER BY id`, [MY_WORK_SCREEN_AUDIT.UPDATED]);
    expect(rows).toHaveLength(3);
    const last = JSON.parse(rows[2].details);
    expect(last).toEqual({ before: { enabled: true, pilotUserIds: [] }, after: { enabled: false, pilotUserIds: [] } });
    expect(rows[2].userId).toBe(f.users.admin.id);
  });
});
