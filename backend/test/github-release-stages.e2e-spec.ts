import { INestApplication } from '@nestjs/common';
import { createHmac, generateKeyPairSync } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { GithubReleasesService } from '../src/github-releases/github-releases.service';
import { classifyStage, cleanStages, globMatch, resolveP1Stage, ReleaseStage } from '../src/github-releases/github-releases';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

const SECRET = 'test-webhook-secret';
const LMS = 'Vistoria/lms-web';
const INS = 'Vistoria/claims-app';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_REL = 'c'.repeat(40);

// Multi-stage release path, Stage 1 (2026-11-11): stages per repository
// (Dev -> Test -> Training -> Production), its own switch (OFF), every
// stage deploy recorded, task stage progress (with or without a
// Resolution), the P1 sign-off stage (default Test) feeding the staging
// date, and repositories without stages (Insurance) unchanged.
describe('GitHub multi-stage release path (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let github: GithubReleasesService;
  let api: Server;
  let phaseId: number;
  let lmsId: number;
  let insId: number;
  const t: Record<string, number> = {};

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  let seq = 0;
  const deliver = async (repo: string, event: string, payload: any) => {
    const body = JSON.stringify({ installation: { id: 77 }, repository: { full_name: repo }, ...payload });
    const res = await http()
      .post('/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', event)
      .set('X-GitHub-Delivery', `s-${++seq}`)
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`)
      .send(body);
    await github.settled();
    return { res, row: (await ds.query(`SELECT * FROM github_webhook_deliveries ORDER BY id DESC LIMIT 1`))[0] };
  };
  const deployed = (env: string, sha: string, at: string, description = '') => ({
    deployment_status: { state: 'success', created_at: at },
    deployment: { environment: env, sha, ref: 'develop', description, creator: { login: 'dev-a' } },
  });
  const workflow = (name: string, branch: string, sha: string, at: string, message: string) => ({
    action: 'completed',
    workflow_run: { name, conclusion: 'success', head_branch: branch, head_sha: sha, updated_at: at, head_commit: { message }, actor: { login: 'dev-a' } },
  });
  const released = (tag: string, prerelease: boolean, at: string, name = '') => ({
    action: 'published',
    release: { tag_name: tag, prerelease, draft: false, name, author: { login: 'dev-a' }, published_at: at },
  });
  const progress = (taskId: number) =>
    ds.query(`SELECT "stageKey", "stageName", "firstReachedAt", "lastReachedAt", "firstVersion" FROM task_stage_progress WHERE "taskId" = $1 ORDER BY "firstReachedAt", "stageKey"`, [taskId]);
  const newTask = async (title: string, projectId: number, withResolution: boolean, status = 'Pass') => {
    const id = (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "isDefect")
         VALUES ($1, $2, 'P', $3, 'M', $4, 'Build', $5, 'x', $6, $7, $8, $9, $10, false) RETURNING id`,
        [f.tenants.t1, projectId, f.modules.mA, phaseId, title, status, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;
    if (withResolution) {
      await ds.query(
        `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", "resolution", "submittedByUserId", "submittedByEmail", "submittedAt", status, "reviewType", "reviewedAt")
         VALUES ($1, $2, 1, 'Fixed it', $3, $4, now(), 'approved', 'qa', now())`,
        [f.tenants.t1, id, f.users.devA.id, f.users.devA.email],
      );
    }
    return id;
  };
  const STAGES = [
    { name: 'Dev', environments: ['dev'], workflows: ['Deploy'], branches: ['develop'] },
    { name: 'Test', environments: ['test'], tagPatterns: ['*-test.*'] },
    { name: 'Training', environments: ['training'] },
    { name: 'Production', production: true, environments: ['production'] },
  ];

  beforeAll(async () => {
    // A stand-in for api.github.com: App token, tag -> commit, commit text.
    api = createServer((req, res) => {
      const json = (body: any, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/app/installations/77/access_tokens' && req.method === 'POST') return json({ token: 'inst-token', expires_at: new Date(Date.now() + 3600_000).toISOString() });
      if (req.headers.authorization !== 'Bearer inst-token') return json({ message: 'bad token' }, 401);
      const m = req.url!.match(/^\/repos\/Vistoria\/lms-web\/commits\/([^/]+)$/);
      const ref = m ? decodeURIComponent(m[1]) : null;
      if (ref === 'v1.0.0-test.1') return json({ sha: SHA_B, commit: { message: 'tag' } });
      if (ref === 'v1.0.0') return json({ sha: SHA_REL, commit: { message: 'tag' } });
      if (ref === SHA_B) return json({ sha: SHA_B, commit: { message: `TRK-${t.res} test build` } });
      if (ref === SHA_REL) return json({ sha: SHA_REL, commit: { message: `TRK-${t.res} TRK-${t.noRes} release` } });
      if (/\/pulls$/.test(req.url!)) return json([]);
      return json({ message: 'not found' }, 404);
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const dir = mkdtempSync(join(tmpdir(), 'gh-app-'));
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(join(dir, 'app.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY_PATH = join(dir, 'app.pem');
    process.env.GITHUB_API_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

    const app0 = await createTestApp();
    app = app0.app;
    ds = app0.dataSource;
    tokenFor = app0.tokenFor;
    f = await seedFixtures(ds);
    github = app.get(GithubReleasesService);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, releases, release_items, audit_logs, github_settings, github_repo_mappings, github_webhook_deliveries, github_staging_deployments, github_stage_deployments, task_stage_progress RESTART IDENTITY CASCADE`,
    );
    phaseId = (
      await ds.query(`INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'LMS', $3, 'M', 'Build') RETURNING id`, [
        f.tenants.t1,
        f.projects.pLms,
        f.modules.mA,
      ])
    )[0].id;
    t.res = await newTask('Has a Resolution', f.projects.pLms, true);
    t.noRes = await newTask('No Resolution yet', f.projects.pLms, false, 'In Progress');
    t.wf = await newTask('Via workflow', f.projects.pLms, false, 'In Progress');
    t.junk = await newTask('Junked', f.projects.pLms, false, 'Junk');
    t.other = await newTask('Other project', f.projects.pA, true);
    const mk = async (repo: string, projectId: number, appName: string) =>
      (await http().post('/github-releases/mappings').set(auth(f.users.admin)).send({ repoFullName: repo, projectId, appName }).expect(201)).body.id as number;
    lmsId = await mk(LMS, f.projects.pLms, 'LMS Web');
    insId = await mk(INS, f.projects.pA, 'Claims');
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => api?.close(resolve));
    for (const k of ['GITHUB_WEBHOOK_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY_PATH', 'GITHUB_API_URL']) delete process.env[k];
  });

  it('stage lists are checked; a valid list is saved (Admin/PM only, audited); P1 stage defaults to Test', async () => {
    const save = (u: FixtureUser, body: any) => http().patch(`/github-releases/mappings/${lmsId}`).set(auth(u)).send(body);
    await save(f.users.devA, { stages: STAGES }).expect(403);
    const bad: Array<[any, RegExp]> = [
      [{ stages: [STAGES[3]] }, /2 to 8 stages/],
      [{ stages: [STAGES[3], STAGES[0]] }, /Production, and it must be the last/],
      [{ stages: [{ ...STAGES[0], production: true }, STAGES[3]] }, /Exactly one stage is Production/],
      [{ stages: [STAGES[0], { ...STAGES[1], name: 'dev' }, STAGES[3]] }, /Two stages are called/],
      [{ stages: [STAGES[0], { ...STAGES[1], environments: ['DEV'] }, STAGES[3]] }, /Environment "dev" is in both Dev and Test/],
      [{ stages: [{ name: 'Dev', branches: ['develop'] }, STAGES[3]] }, /together with a deploy workflow/],
      [{ stages: [{ name: 'Dev' }, STAGES[3]] }, /at least one environment/],
      [{ stages: [{ name: 'Dev', tagPatterns: ['*'] }, STAGES[3]] }, /tag pattern/],
      [{ stages: [STAGES[0], { name: 'Test', workflows: ['deploy'] }, STAGES[3]] }, /would count for both/],
      [{ stages: STAGES, p1StageKey: 'staging' }, /must be one of this repository/],
      [{ stages: STAGES, p1StageKey: 'production' }, /before Production/],
    ];
    for (const [body, msg] of bad) expect(String((await save(f.users.pm, body).expect(400)).body.message)).toMatch(msg);
    const res = await save(f.users.pm, { stages: STAGES }).expect(200);
    expect(res.body.stages.map((s: ReleaseStage) => [s.key, s.production])).toEqual([
      ['dev', false],
      ['test', false],
      ['training', false],
      ['production', true],
    ]);
    expect(res.body.p1StageKey).toBeNull();
    expect(resolveP1Stage(res.body.stages, null)!.name).toBe('Test');
    const audits = await ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'github_repo_mapping_updated'`);
    expect(audits[0].n).toBe(1);
  });

  it('switch OFF: deliveries use the old Staging/Production rules - nothing recorded per stage', async () => {
    await http().patch('/github-releases/settings').set(auth(f.users.admin)).send({ enabled: true }).expect(200);
    const { row } = await deliver(LMS, 'deployment_status', deployed('test', SHA_A, '2026-11-04T08:00:00Z', `TRK-${t.res}`));
    expect(row).toMatchObject({ outcome: 'ignored', stageName: null, reason: expect.stringContaining('staging or production list') });
    expect((await ds.query(`SELECT count(*)::int AS n FROM github_stage_deployments`))[0].n).toBe(0);
  });

  it('switch ON: each stage deploy recorded; tasks reach stages with or without a Resolution; Junk and other projects never', async () => {
    const s = await http().patch('/github-releases/settings').set(auth(f.users.pm)).send({ releaseStagesEnabled: true }).expect(200);
    expect(s.body.settings).toMatchObject({ enabled: true, releaseStagesEnabled: true });

    let { row } = await deliver(LMS, 'deployment_status', deployed('dev', SHA_A, '2026-11-03T08:00:00Z', `TRK-${t.res} TRK-${t.noRes} TRK-${t.junk} TRK-${t.other}`));
    expect(row).toMatchObject({ outcome: 'processed', stageName: 'Dev', environment: 'staging' });
    expect(row.reason).toMatch(/2 task\(s\) reached Dev; not in this project or Junk: TRK-\d+, TRK-\d+/);

    ({ row } = await deliver(LMS, 'workflow_run', workflow('Deploy', 'develop', SHA_A, '2026-11-03T09:00:00Z', `TRK-${t.wf} via workflow`)));
    expect(row).toMatchObject({ outcome: 'processed', stageName: 'Dev' });
    ({ row } = await deliver(LMS, 'workflow_run', workflow('Deploy', 'main', SHA_A, '2026-11-03T09:00:00Z', 'x')));
    expect(row).toMatchObject({ outcome: 'ignored', reason: expect.stringContaining('not a deploy to any') });

    ({ row } = await deliver(LMS, 'release', released('v1.0.0-test.1', true, '2026-11-05T08:00:00Z')));
    expect(row).toMatchObject({ outcome: 'processed', stageName: 'Test' });
    ({ row } = await deliver(LMS, 'release', released('v1.0.0-rc.9', true, '2026-11-05T09:00:00Z')));
    expect(row).toMatchObject({ outcome: 'ignored', reason: expect.stringContaining('matches no stage') });

    ({ row } = await deliver(LMS, 'deployment_status', deployed('training', SHA_B, '2026-11-07T08:00:00Z', `TRK-${t.res}`)));
    expect(row).toMatchObject({ outcome: 'processed', stageName: 'Training' });

    expect((await progress(t.noRes)).map((p: any) => p.stageName)).toEqual(['Dev']);
    expect((await progress(t.wf)).map((p: any) => p.stageName)).toEqual(['Dev']);
    expect((await progress(t.res)).map((p: any) => p.stageName)).toEqual(['Dev', 'Test', 'Training']);
    expect(await progress(t.junk)).toEqual([]);
    expect(await progress(t.other)).toEqual([]);
    const deploys = await ds.query(`SELECT "stageKey", sha, version FROM github_stage_deployments ORDER BY id`);
    expect(deploys.map((d: any) => d.stageKey)).toEqual(['dev', 'dev', 'test', 'training']);
    expect(deploys[2]).toMatchObject({ sha: SHA_B, version: '1.0.0-test.1' });
  });

  it('Production: Release Log entry as before, staging date from the P1 stage (Test); Resolution rule only there', async () => {
    const { row } = await deliver(LMS, 'release', released('v1.0.0', false, '2026-11-10T08:00:00Z'));
    expect(row).toMatchObject({ outcome: 'processed', stageName: 'Production', environment: 'production' });
    expect(row.reason).toMatch(/Production 1\.0\.0: Release created.*2 task\(s\) reached Production/);
    const [rel] = await ds.query(`SELECT id, version, "releaseDate"::text, "githubStagingDeployedOn"::text, "githubNotes" FROM releases WHERE "appName" = 'LMS Web'`);
    expect(rel).toMatchObject({ version: '1.0.0', releaseDate: '2026-11-10', githubStagingDeployedOn: '2026-11-05' });
    const items = await ds.query(`SELECT "taskId" FROM release_items WHERE "releaseId" = $1`, [rel.id]);
    expect(items.map((i: any) => i.taskId)).toEqual([t.res]);
    expect(rel.githubNotes.some((n: string) => n.startsWith(`TRK-${t.noRes}`))).toBe(true);
    expect((await progress(t.noRes)).map((p: any) => p.stageName)).toEqual(['Dev', 'Production']);
  });

  it('first/last reached: a later deploy moves "last"; an earlier one seen late moves "first"', async () => {
    await deliver(LMS, 'deployment_status', deployed('dev', SHA_B, '2026-11-08T08:00:00Z', `TRK-${t.res}`));
    await deliver(LMS, 'deployment_status', deployed('dev', SHA_A, '2026-11-01T08:00:00Z', `TRK-${t.res}`));
    const [dev] = (await progress(t.res)).filter((p: any) => p.stageKey === 'dev');
    expect(new Date(dev.firstReachedAt).toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(new Date(dev.lastReachedAt).toISOString()).toBe('2026-11-08T08:00:00.000Z');
  });

  it('a chosen P1 stage is used instead of Test', async () => {
    await http().patch(`/github-releases/mappings/${lmsId}`).set(auth(f.users.admin)).send({ p1StageKey: 'training' }).expect(200);
    await deliver(LMS, 'deployment_status', deployed('test', SHA_A, '2026-11-12T08:00:00Z'));
    await deliver(LMS, 'deployment_status', deployed('training', SHA_A, '2026-11-13T08:00:00Z'));
    await deliver(LMS, 'deployment_status', deployed('production', SHA_A, '2026-11-14T08:00:00Z'));
    const [rel] = await ds.query(`SELECT "githubStagingDeployedOn"::text FROM releases WHERE "githubSha" = $1`, [SHA_A]);
    expect(rel.githubStagingDeployedOn).toBe('2026-11-13');
  });

  it('Insurance (no stages) is unchanged with the switch ON: Staging/Production as before, nothing per stage', async () => {
    const before = (await ds.query(`SELECT count(*)::int AS n FROM github_stage_deployments`))[0].n;
    const { row } = await deliver(INS, 'deployment_status', { ...deployed('staging', SHA_A, '2026-11-04T08:00:00Z'), repository: { full_name: INS } });
    expect(row).toMatchObject({ outcome: 'processed', stageName: null, environment: 'staging', reason: expect.stringContaining('Staging deployment recorded') });
    expect((await ds.query(`SELECT count(*)::int AS n FROM github_staging_deployments WHERE "mappingId" = $1`, [insId]))[0].n).toBe(1);
    expect((await ds.query(`SELECT count(*)::int AS n FROM github_stage_deployments`))[0].n).toBe(before);
  });

  it('task page: stage progress per repository, for whoever may see the task; nothing for a project without stages', async () => {
    const res = await http().get(`/github-releases/task-progress?taskId=${t.res}`).set(auth(f.users.devA)).expect(200);
    expect(res.body.enabled).toBe(true);
    const [repo] = res.body.repos;
    expect(repo).toMatchObject({ repoFullName: LMS, appName: 'LMS Web' });
    const at = (k: string) => repo.stages.find((x: any) => x.key === k);
    expect(repo.stages.map((x: any) => x.name)).toEqual(['Dev', 'Test', 'Training', 'Production']);
    expect(new Date(at('dev').firstReachedAt).toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(new Date(at('test').firstReachedAt).toISOString()).toBe('2026-11-05T08:00:00.000Z');
    expect(at('test').firstVersion).toBe('1.0.0-test.1');
    expect(new Date(at('production').firstReachedAt).toISOString()).toBe('2026-11-10T08:00:00.000Z');
    const wf = await http().get(`/github-releases/task-progress?taskId=${t.wf}`).set(auth(f.users.pm)).expect(200);
    expect(wf.body.repos[0].stages.filter((x: any) => x.firstReachedAt).map((x: any) => x.name)).toEqual(['Dev']);
    await http().get(`/github-releases/task-progress?taskId=${t.res}`).set(auth(f.users.clientA)).expect(403);
    await http().get('/github-releases/task-progress').set(auth(f.users.pm)).expect(400);
    expect((await http().get(`/github-releases/task-progress?taskId=${t.other}`).set(auth(f.users.pm)).expect(200)).body).toEqual({ enabled: false, repos: [] });
  });

  it('Release Log: when the release reached each stage (PM only); stages it never went through show nothing', async () => {
    const [rel] = await ds.query(`SELECT id FROM releases WHERE "appName" = 'LMS Web' AND version = '1.0.0'`);
    await http().get(`/github-releases/release-path/${rel.id}`).set(auth(f.users.devA)).expect(403);
    const res = await http().get(`/github-releases/release-path/${rel.id}`).set(auth(f.users.pm)).expect(200);
    expect(res.body).toMatchObject({ enabled: true, repoFullName: LMS, p1StageKey: 'training' });
    const when = (k: string) => {
      const st = res.body.stages.find((x: any) => x.key === k);
      return st.deployedAt ? new Date(st.deployedAt).toISOString().slice(0, 10) : null;
    };
    expect(['dev', 'test', 'training', 'production'].map(when)).toEqual([null, '2026-11-05', null, '2026-11-10']);
    await http().get('/github-releases/release-path/999999').set(auth(f.users.pm)).expect(404);
  });

  it('switch OFF: the task page and Release Log show no stages (data kept)', async () => {
    await http().patch('/github-releases/settings').set(auth(f.users.admin)).send({ releaseStagesEnabled: false }).expect(200);
    expect((await http().get(`/github-releases/task-progress?taskId=${t.res}`).set(auth(f.users.pm)).expect(200)).body).toEqual({ enabled: false, repos: [] });
    const [rel] = await ds.query(`SELECT id FROM releases WHERE "appName" = 'LMS Web' AND version = '1.0.0'`);
    expect((await http().get(`/github-releases/release-path/${rel.id}`).set(auth(f.users.pm)).expect(200)).body).toEqual({ enabled: false });
    expect((await ds.query(`SELECT count(*)::int AS n FROM task_stage_progress`))[0].n).toBeGreaterThan(0);
    await http().patch('/github-releases/settings').set(auth(f.users.admin)).send({ releaseStagesEnabled: true }).expect(200);
  });

  it('removing the stages takes a repository back to Staging/Production', async () => {
    await http().patch(`/github-releases/mappings/${lmsId}`).set(auth(f.users.admin)).send({ stages: [], p1StageKey: null }).expect(200);
    const { row } = await deliver(LMS, 'deployment_status', deployed('staging', SHA_B, '2026-11-15T08:00:00Z'));
    expect(row).toMatchObject({ outcome: 'processed', stageName: null, reason: expect.stringContaining('Staging deployment recorded') });
  });

  describe('pure rules', () => {
    const stages = (cleanStages(STAGES) as { value: ReleaseStage[] }).value;
    it('globMatch', () => {
      expect(globMatch('*-test.*', 'v1.0.0-test.1')).toBe(true);
      expect(globMatch('*-test.*', 'v1.0.0-TEST.2')).toBe(true);
      expect(globMatch('*-test.*', 'v1.0.0-rc.1')).toBe(false);
      expect(globMatch('v1.?', 'v1.2')).toBe(false); // ? is literal
      expect(globMatch('release/*', 'release/2026-11')).toBe(true);
    });
    it('resolveP1Stage: chosen, else Test, else the stage before Production', () => {
      expect(resolveP1Stage(stages, 'dev')!.key).toBe('dev');
      expect(resolveP1Stage(stages, null)!.key).toBe('test');
      const noTest = (cleanStages([STAGES[0], STAGES[2], STAGES[3]]) as any).value;
      expect(resolveP1Stage(noTest, null)!.key).toBe('training');
    });
    it('classifyStage: published release = Production unless a tag pattern says otherwise; failures and drafts ignored', () => {
      expect((classifyStage('release', released('v2.0.0', false, '2026-11-01T00:00:00Z'), stages) as any).stage.key).toBe('production');
      expect((classifyStage('release', released('v2.0.0-test.3', false, '2026-11-01T00:00:00Z'), stages) as any).stage.key).toBe('test');
      expect(classifyStage('release', { action: 'published', release: { tag_name: 'v1', draft: true } }, stages).use).toBe(false);
      expect(classifyStage('deployment_status', { deployment_status: { state: 'failure' }, deployment: { environment: 'dev' } }, stages).use).toBe(false);
      expect(classifyStage('push', {}, stages).use).toBe(false);
    });
  });
});
