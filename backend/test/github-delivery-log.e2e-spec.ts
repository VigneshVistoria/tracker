import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { GithubReleasesService } from '../src/github-releases/github-releases.service';
import { deliveryStageName, deliverySummary } from '../src/github-releases/github-releases';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

const SECRET = 'test-webhook-secret';
const REPO = 'Vistoria/lms-core-foundation';
const SHA = 'a'.repeat(40);
const MERGE = 'Merge TRK-335 F3 schema + create/picker (Bhavani, reviewed)\n\n- details TRK-12';

// Delivery log details (2026-11-20): GitHub user (+ Tracker name), branch,
// PR title / commit message, workflow, task numbers and stage on EVERY
// signed delivery - ignored ones too - plus search and a recorded/ignored filter.
describe('GitHub: delivery log details, search and filter (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let github: GithubReleasesService;
  let devName: string;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  let seq = 0;
  const deliver = async (event: string, payload: any, signed = true) => {
    const body = JSON.stringify({ repository: { full_name: REPO }, ...payload });
    await http()
      .post('/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', event)
      .set('X-GitHub-Delivery', `dl-${++seq}`)
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', signed ? SECRET : 'wrong').update(body).digest('hex')}`)
      .send(body);
    await github.settled();
    return (await ds.query(`SELECT * FROM github_webhook_deliveries ORDER BY id DESC LIMIT 1`))[0];
  };
  // A "Postgres migration frontend" run on develop, pushed by Bhavani.
  const run = (name: string, action = 'requested') => ({
    action,
    sender: { login: 'Bhavani-Elumalai' },
    workflow_run: { name, head_branch: 'develop', head_sha: SHA, display_title: 'Merge TRK-335 F3 schema…', head_commit: { message: MERGE }, triggering_actor: { login: 'Bhavani-Elumalai' } },
  });
  const STAGES = [
    { name: 'Dev', environments: ['develop'] },
    { name: 'Test', environments: ['test'] },
    { name: 'Production', production: true, environments: ['production'] },
  ];
  const list = async (u: FixtureUser, query = '') => (await http().get(`/github-releases/deliveries${query}`).set(auth(u)).expect(200)).body;

  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    const app0 = await createTestApp();
    app = app0.app;
    ds = app0.dataSource;
    tokenFor = app0.tokenFor;
    f = await seedFixtures(ds);
    github = app.get(GithubReleasesService);
    await ds.query(
      `TRUNCATE project_tasks, releases, release_items, audit_logs, github_settings, github_repo_mappings, github_webhook_deliveries, github_staging_deployments, github_stage_deployments, task_stage_progress RESTART IDENTITY CASCADE`,
    );
    await ds.query(`UPDATE users SET "githubLogin" = 'Bhavani-Elumalai' WHERE id = $1`, [f.users.devA.id]);
    devName = (await ds.query(`SELECT "fullName" FROM users WHERE id = $1`, [f.users.devA.id]))[0].fullName;
    const post = (body: any) => http().post('/github-releases/mappings').set(auth(f.users.admin)).send(body).expect(201);
    await post({ repoFullName: REPO, projectId: f.projects.pLms, appName: 'LMS Frontend', appWorkflows: ['Frontend CI/CD'], stages: STAGES });
    await post({ repoFullName: REPO, projectId: f.projects.pLms, appName: 'LMS Backend', appWorkflows: ['Backend CI/CD'], stages: STAGES });
  });

  afterAll(async () => {
    await ds?.query(`UPDATE users SET "githubLogin" = NULL WHERE id = $1`, [f.users.devA.id]);
    await app?.close();
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  it('summary helpers: user, branch, title, workflow, tasks, stage', () => {
    expect(deliverySummary(run('Postgres migration frontend'), 'TRK')).toEqual({
      githubLogin: 'Bhavani-Elumalai',
      branch: 'develop',
      title: 'Merge TRK-335 F3 schema + create/picker (Bhavani, reviewed)',
      workflowName: 'Postgres migration frontend',
      taskIds: [12, 335],
    });
    // A job names its workflow as workflow_name; a PR's title and branch count.
    expect(deliverySummary({ workflow_job: { workflow_name: 'Backend CI/CD', head_branch: 'feature/TRK-7-x' }, sender: { login: 'u1' } }, 'TRK')).toMatchObject({
      githubLogin: 'u1',
      branch: 'feature/TRK-7-x',
      title: null,
      workflowName: 'Backend CI/CD',
      taskIds: [7],
    });
    expect(deliverySummary({ pull_request: { title: 'TRK-9 fix', head: { ref: 'feature/trk-10' }, user: { login: 'pr-author' } }, sender: { login: 'x' } }, 'TRK')).toMatchObject({
      githubLogin: 'pr-author',
      title: 'TRK-9 fix',
      taskIds: [9, 10],
    });
    expect(deliverySummary({ ref: 'refs/heads/main', head_commit: { message: 'ABC-4 done' } }, 'ABC')).toMatchObject({ branch: 'main', title: 'ABC-4 done', taskIds: [4] });
    const stages = STAGES.map((s) => ({ key: s.name.toLowerCase(), production: false, workflows: [], branches: [], tagPatterns: [], ...s }));
    expect(deliveryStageName({ deployment: { environment: 'test' } }, 'develop', stages)).toBe('Test');
    expect(deliveryStageName({ deployment: { environment: 'nowhere' } }, 'develop', stages)).toBeNull();
    expect(deliveryStageName({}, 'develop', stages)).toBe('Dev');
    expect(deliveryStageName({}, 'feature/x', stages)).toBeNull();
    expect(deliveryStageName({}, 'develop', [])).toBeNull();
  });

  it('ignored deliveries still log the user, branch, title, workflow, tasks and stage', async () => {
    const row = await deliver('workflow_run', run('Postgres migration frontend'));
    expect(row).toMatchObject({
      outcome: 'ignored',
      githubLogin: 'Bhavani-Elumalai',
      branch: 'develop',
      title: 'Merge TRK-335 F3 schema + create/picker (Bhavani, reviewed)',
      workflowName: 'Postgres migration frontend',
      taskIds: [12, 335],
      stageName: 'Dev',
    });
    expect(row.reason).toContain('belongs to none of the apps');
    // Matched app, switch off: same details.
    expect(await deliver('workflow_run', run('Frontend CI/CD'))).toMatchObject({ outcome: 'ignored', workflowName: 'Frontend CI/CD', taskIds: [12, 335], stageName: 'Dev' });
  });

  it('unsigned deliveries store none of the payload text', async () => {
    const row = await deliver('workflow_run', run('Frontend CI/CD'), false);
    expect(row).toMatchObject({ outcome: 'refused', githubLogin: null, branch: null, title: null, workflowName: null, taskIds: [], stageName: null });
  });

  it('a recorded deploy has the details too', async () => {
    await http().patch('/github-releases/settings').set(auth(f.users.admin)).send({ enabled: true, releaseStagesEnabled: true }).expect(200);
    const row = await deliver('deployment_status', {
      deployment_status: { state: 'success', created_at: '2026-11-20T07:43:19Z' },
      deployment: { environment: 'develop', sha: SHA, ref: 'develop', creator: { login: 'Bhavani-Elumalai' } },
      workflow: { name: 'Frontend CI/CD' },
      workflow_run: { name: 'Frontend CI/CD', head_branch: 'develop', head_commit: { message: MERGE } },
    });
    expect(row).toMatchObject({ outcome: 'processed', githubLogin: 'Bhavani-Elumalai', workflowName: 'Frontend CI/CD', taskIds: [12, 335], stageName: 'Dev' });
  });

  it('the log: Tracker name, search by task or name, recorded/ignored filter', async () => {
    const all = await list(f.users.admin);
    expect(all.length).toBe(4);
    const signed = all.filter((d: any) => d.signatureValid);
    expect(signed.every((d: any) => d.trackerName === devName)).toBe(true);
    expect(all.find((d: any) => !d.signatureValid).trackerName).toBeNull();

    expect((await list(f.users.admin, '?search=TRK-335')).length).toBe(3);
    expect((await list(f.users.admin, '?search=335')).length).toBe(3);
    expect((await list(f.users.admin, '?search=trk-12')).length).toBe(3);
    expect(await list(f.users.admin, '?search=TRK-999')).toEqual([]);
    expect((await list(f.users.admin, '?search=bhavani-ELU')).length).toBe(3);
    expect((await list(f.users.admin, `?search=${encodeURIComponent(devName.slice(0, 4))}`)).length).toBe(3);
    expect(await list(f.users.admin, '?search=nobody')).toEqual([]);
    expect(await list(f.users.admin, '?search=%25')).toEqual([]);

    const recorded = await list(f.users.admin, '?show=recorded');
    expect(recorded.map((d: any) => d.outcome)).toEqual(['processed']);
    const ignored = await list(f.users.admin, '?show=ignored&search=TRK-335');
    expect(ignored.length).toBe(2);
    expect(ignored.every((d: any) => d.outcome === 'ignored')).toBe(true);
    await http().get('/github-releases/deliveries?show=bogus').set(auth(f.users.admin)).expect(400);

    // Another tenant's PM: nothing, whatever the search.
    expect(await list(f.users.pmT2, '?search=TRK-335')).toEqual([]);
  });
});
