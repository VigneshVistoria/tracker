import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// GitHub PR helpers (2026-11-11): own switch (OFF), project list, branch
// prefix; the task page reads /github-releases/pr-helper. Independent of the
// GitHub releases switch. Tracker never writes to GitHub.
describe('GitHub PR helpers (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const helper = (u: FixtureUser, projectId: number) => http().get(`/github-releases/pr-helper?projectId=${projectId}`).set(auth(u));
  const save = (u: FixtureUser, body: any) => http().patch('/github-releases/settings').set(auth(u)).send(body);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE audit_logs, github_settings, github_repo_mappings RESTART IDENTITY CASCADE`);
    const map = (repo: string, projectId: number, active = true) =>
      ds.query(`INSERT INTO github_repo_mappings ("tenantId", "repoFullName", "projectId", "appName", active, "createdByUserId") VALUES ($1, $2, $3, $4, $5, $6)`, [
        f.tenants.t1,
        repo,
        projectId,
        repo.split('/')[1],
        active,
        f.users.admin.id,
      ]);
    await map('vistoria/lms-web', f.projects.pLms);
    await map('vistoria/lms-api', f.projects.pLms);
    await map('vistoria/lms-old', f.projects.pLms, false);
    await map('vistoria/project-a', f.projects.pA);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('OFF by default: nothing for any project; settings show the defaults', async () => {
    expect((await helper(f.users.devA, f.projects.pLms).expect(200)).body).toEqual({ enabled: false });
    const page = await http().get('/github-releases/settings').set(auth(f.users.admin)).expect(200);
    expect(page.body.settings).toMatchObject({ enabled: false, prHelpersEnabled: false, prHelperProjectIds: [], branchPrefix: 'feature/' });
  });

  it('who can read it: any internal user, never a client; projectId required', async () => {
    await helper(f.users.clientA, f.projects.pLms).expect(403);
    await http().get('/github-releases/pr-helper').set(auth(f.users.devA)).expect(400);
    for (const u of [f.users.devA, f.users.qaB, f.users.pm, f.users.exec]) await helper(u, f.projects.pLms).expect(200);
  });

  it('settings are checked: projects needed to switch on, real projects only, branch prefix format; only Admin/PM', async () => {
    await save(f.users.devA, { prHelpersEnabled: true, prHelperProjectIds: [f.projects.pLms] }).expect(403);
    expect((await save(f.users.admin, { prHelpersEnabled: true }).expect(400)).body.message).toMatch(/at least one project/);
    expect((await save(f.users.admin, { prHelperProjectIds: [f.projects.pT2] }).expect(400)).body.message).toMatch(/does not exist/);
    for (const branchPrefix of ['feature', 'feat ure/', '/', 'a//', '-x/']) {
      expect((await save(f.users.admin, { branchPrefix }).expect(400)).body.message).toMatch(/branch prefix/);
    }
    expect(await ds.query(`SELECT * FROM github_settings`)).toEqual([]);
  });

  it('ON for LMS only: LMS tasks get the active LMS repos; other projects nothing; releases switch untouched; audited', async () => {
    const res = await save(f.users.pm, { prHelpersEnabled: true, prHelperProjectIds: [f.projects.pLms, f.projects.pLms], branchPrefix: ' Fix/ ' }).expect(200);
    expect(res.body.settings).toMatchObject({ enabled: false, prHelpersEnabled: true, prHelperProjectIds: [f.projects.pLms], branchPrefix: 'fix/' });
    expect((await helper(f.users.devA, f.projects.pLms).expect(200)).body).toEqual({
      enabled: true,
      taskKeyPrefix: 'TRK',
      branchPrefix: 'fix/',
      repos: [
        { repoFullName: 'vistoria/lms-api', appName: 'lms-api' },
        { repoFullName: 'vistoria/lms-web', appName: 'lms-web' },
      ],
    });
    expect((await helper(f.users.devA, f.projects.pA).expect(200)).body).toEqual({ enabled: false });
    const [audit] = await ds.query(`SELECT "userId", details FROM audit_logs WHERE action = 'github_settings_updated'`);
    expect(audit.userId).toBe(f.users.pm.id);
    expect(JSON.parse(audit.details)).toMatchObject({ before: { prHelpersEnabled: false, branchPrefix: 'feature/' }, after: { prHelpersEnabled: true, enabled: false } });
    // Saving the releases switch alone keeps the helper settings.
    await save(f.users.admin, { taskKeyPrefix: 'LMS' }).expect(200);
    expect((await helper(f.users.devA, f.projects.pLms).expect(200)).body).toMatchObject({ enabled: true, taskKeyPrefix: 'LMS', branchPrefix: 'fix/' });
  });

  it('switching off hides them again; the database also refuses a bad prefix', async () => {
    await save(f.users.admin, { prHelpersEnabled: false, taskKeyPrefix: 'TRK' }).expect(200);
    expect((await helper(f.users.devA, f.projects.pLms).expect(200)).body).toEqual({ enabled: false });
    await expect(ds.query(`UPDATE github_settings SET "branchPrefix" = 'Feature/'`)).rejects.toThrow(/CHK_github_settings_branch_prefix/);
  });
});
