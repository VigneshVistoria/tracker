import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { GithubReleasesService } from '../src/github-releases/github-releases.service';
import { appWorkflowsProblem, eventWorkflowName, pickAppMapping } from '../src/github-releases/github-releases';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

const SECRET = 'test-webhook-secret';
const REPO = 'Vistoria/lms-core-foundation';
const SHA_T = 't'.repeat(40);
const SHA_P = 'p'.repeat(40);
const FE = 'Frontend CI/CD';
const BE = 'Backend CI/CD';

// Two apps in one repository, told apart by workflow name (2026-11-18, the
// user's decision for the LMS pilot), and the P1 sign-off date taken by
// task (Test and Production are separate builds - commits differ).
describe('GitHub: two apps in one repository + P1 by task (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let github: GithubReleasesService;
  let phaseId: number;
  let feId: number;
  let beId: number;
  const t: Record<string, number> = {};

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  let seq = 0;
  const deliver = async (event: string, payload: any) => {
    const body = JSON.stringify({ repository: { full_name: REPO }, ...payload });
    const res = await http()
      .post('/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', event)
      .set('X-GitHub-Delivery', `aw-${++seq}`)
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`)
      .send(body);
    await github.settled();
    return { res, row: (await ds.query(`SELECT * FROM github_webhook_deliveries ORDER BY id DESC LIMIT 1`))[0] };
  };
  // A Deploy job with "environment:" - GitHub adds the run and workflow.
  const deployed = (workflow: string | null, env: string, sha: string, at: string, description = '') => ({
    deployment_status: { state: 'success', created_at: at },
    deployment: { environment: env, sha, ref: env === 'production' ? 'main' : env, description, creator: { login: 'Bhavani-Elumalai' } },
    ...(workflow ? { workflow: { name: workflow }, workflow_run: { name: workflow, head_branch: env } } : {}),
  });
  const newTask = async (title: string) =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "isDefect")
         VALUES ($1, $2, 'LMS', $3, 'M', $4, 'Build', $5, 'x', 'In Progress', $6, $7, $8, $9, false) RETURNING id`,
        [f.tenants.t1, f.projects.pLms, f.modules.mA, phaseId, title, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;
  const STAGES = [
    { name: 'Dev', environments: ['develop'] },
    { name: 'Test', environments: ['test'] },
    { name: 'Training', environments: ['training'] },
    { name: 'Production', production: true, environments: ['production'] },
  ];
  const mapping = (appName: string, appWorkflows: string[]) => ({ repoFullName: REPO, projectId: f.projects.pLms, appName, appWorkflows, stages: STAGES });

  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
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
    t.a = await newTask('On Test early');
    t.c = await newTask('On Test later');
    t.b = await newTask('Never on Test');
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  it('one repository, two apps: each names its own workflows; clashes refused', async () => {
    const post = (u: FixtureUser, body: any) => http().post('/github-releases/mappings').set(auth(u)).send(body);
    const fe = await post(f.users.admin, mapping('LMS Frontend', [FE])).expect(201);
    feId = fe.body.id;
    expect(fe.body).toMatchObject({ repoFullName: REPO, appName: 'LMS Frontend', appWorkflows: [FE] });
    expect(String((await post(f.users.admin, mapping('LMS Backend', [])).expect(400)).body.message)).toMatch(/give LMS Backend its app workflows/);
    expect(String((await post(f.users.admin, mapping('LMS Backend', ['frontend ci/cd'])).expect(400)).body.message)).toMatch(/already LMS Frontend's/);
    expect(String((await post(f.users.admin, mapping('lms frontend', [BE])).expect(409)).body.message)).toMatch(/already has an app called/);
    await post(f.users.pmT2, { ...mapping('Other', [BE]), projectId: f.projects.pT2 }).expect(409);
    beId = (await post(f.users.pm, mapping('LMS Backend', [BE])).expect(201)).body.id;
    // Taking the workflows away while the repository is shared: refused.
    expect(String((await http().patch(`/github-releases/mappings/${feId}`).set(auth(f.users.admin)).send({ appWorkflows: [] }).expect(400)).body.message)).toMatch(
      /give LMS Frontend its app workflows/,
    );
  });

  it('switch OFF: a deploy is matched to its app by workflow, then ignored as switched off', async () => {
    let { row } = await deliver('deployment_status', deployed(FE, 'develop', SHA_T, '2026-11-03T08:00:00Z'));
    expect(row).toMatchObject({ tenantId: f.tenants.t1, signatureValid: true, outcome: 'ignored', reason: expect.stringContaining('switched off') });
    expect(row.reason).toContain('(app: LMS Frontend)');
    ({ row } = await deliver('deployment_status', deployed(BE, 'develop', SHA_T, '2026-11-03T08:00:00Z')));
    expect(row.reason).toContain('(app: LMS Backend)');
    ({ row } = await deliver('deployment_status', deployed('Docs', 'develop', SHA_T, '2026-11-03T08:00:00Z')));
    expect(row).toMatchObject({ tenantId: f.tenants.t1, outcome: 'ignored', reason: expect.stringContaining('Workflow "Docs" belongs to none of the apps') });
    ({ row } = await deliver('deployment_status', deployed(null, 'develop', SHA_T, '2026-11-03T08:00:00Z')));
    expect(row).toMatchObject({ outcome: 'ignored', reason: expect.stringContaining('names no workflow') });
    ({ row } = await deliver('ping', {}));
    expect(row).toMatchObject({ outcome: 'ignored', reason: expect.stringContaining('ping: the connection works') });
    expect((await ds.query(`SELECT count(*)::int AS n FROM github_stage_deployments`))[0].n).toBe(0);
  });

  it('switch ON: stage deploys land on the right app', async () => {
    await http().patch('/github-releases/settings').set(auth(f.users.admin)).send({ enabled: true, releaseStagesEnabled: true }).expect(200);
    let { row } = await deliver('deployment_status', deployed(FE, 'test', SHA_T, '2026-11-05T08:00:00Z', `TRK-${t.a}`));
    expect(row).toMatchObject({ outcome: 'processed', stageName: 'Test' });
    ({ row } = await deliver('deployment_status', deployed(FE, 'test', SHA_T, '2026-11-06T09:00:00Z', `TRK-${t.c}`)));
    expect(row).toMatchObject({ outcome: 'processed', stageName: 'Test' });
    ({ row } = await deliver('deployment_status', deployed(BE, 'test', SHA_T, '2026-11-04T08:00:00Z', `TRK-${t.b}`)));
    expect(row).toMatchObject({ outcome: 'processed', stageName: 'Test' });
    const deploys = await ds.query(`SELECT "mappingId" FROM github_stage_deployments ORDER BY id`);
    expect(deploys.map((d: any) => d.mappingId)).toEqual([feId, feId, beId]);
  });

  it('Production: the Test date comes from the tasks (latest of them), not the commit; a task never on Test is flagged', async () => {
    // TRK-b was on Test only for LMS Backend - for LMS Frontend it never was.
    const { row } = await deliver('deployment_status', deployed(FE, 'production', SHA_P, '2026-11-10T08:00:00Z', `TRK-${t.a} TRK-${t.c} TRK-${t.b}`));
    expect(row).toMatchObject({ outcome: 'processed', stageName: 'Production' });
    const [rel] = await ds.query(`SELECT id, "appName", "githubStagingDeployedOn"::text, "githubNotes" FROM releases`);
    expect(rel).toMatchObject({ appName: 'LMS Frontend', githubStagingDeployedOn: '2026-11-06' });
    expect(rel.githubNotes).toContain(`No Test sign-off: TRK-${t.b} reached Production without a Test deploy seen first.`);
    expect(rel.githubNotes.join(' ')).not.toContain('commit or version');
    // The Release Log's stage path reads the Frontend mapping.
    const path = await http().get(`/github-releases/release-path/${rel.id}`).set(auth(f.users.pm)).expect(200);
    expect(path.body).toMatchObject({ enabled: true, repoFullName: REPO, appName: 'LMS Frontend' });
  });

  it('Production with no task on Test at all: no date, every task flagged', async () => {
    const t2 = await newTask('Straight to prod');
    await deliver('deployment_status', deployed(BE, 'production', 'q'.repeat(40), '2026-11-11T08:00:00Z', `TRK-${t2}`));
    const [rel] = await ds.query(`SELECT "githubStagingDeployedOn", "githubNotes" FROM releases WHERE "appName" = 'LMS Backend'`);
    expect(rel.githubStagingDeployedOn).toBeNull();
    expect(rel.githubNotes).toContain(`No Test sign-off: TRK-${t2} reached Production without a Test deploy seen first.`);
  });

  it('task page lists each app; PR helpers show the shared repository once', async () => {
    const res = await http().get(`/github-releases/task-progress?taskId=${t.a}`).set(auth(f.users.pm)).expect(200);
    expect(res.body.repos.map((r: any) => r.appName).sort()).toEqual(['LMS Backend', 'LMS Frontend']);
    await http().patch('/github-releases/settings').set(auth(f.users.admin)).send({ prHelpersEnabled: true, prHelperProjectIds: [f.projects.pLms] }).expect(200);
    const pr = await http().get(`/github-releases/pr-helper?projectId=${f.projects.pLms}`).set(auth(f.users.devA)).expect(200);
    expect(pr.body.repos).toHaveLength(1);
    expect(pr.body.repos[0].repoFullName).toBe(REPO);
    expect(pr.body.repos[0].appName.split(' / ').sort()).toEqual(['LMS Backend', 'LMS Frontend']);
  });

  describe('pure rules', () => {
    const fe = { appName: 'LMS Frontend', appWorkflows: [FE] };
    const be = { appName: 'LMS Backend', appWorkflows: [BE] };
    it('eventWorkflowName', () => {
      expect(eventWorkflowName({ workflow_run: { name: FE } })).toBe(FE);
      expect(eventWorkflowName({ workflow: { name: BE } })).toBe(BE);
      expect(eventWorkflowName({ release: {} })).toBeNull();
    });
    it('pickAppMapping', () => {
      expect(pickAppMapping('deployment_status', {}, [])).toBeNull();
      expect((pickAppMapping('deployment_status', { workflow_run: { name: 'backend ci/cd' } }, [fe, be]) as any).mapping).toBe(be);
      expect((pickAppMapping('release', {}, [fe, be]) as any).reason).toMatch(/names no workflow/);
      expect((pickAppMapping('ping', {}, [fe, be]) as any).mapping).toBe(fe);
      // One app, no workflows listed: everything, as before.
      const solo = { appName: 'Claims', appWorkflows: [] };
      expect((pickAppMapping('release', {}, [solo]) as any).mapping).toBe(solo);
      expect((pickAppMapping('workflow_run', { workflow_run: { name: 'Any' } }, [solo]) as any).mapping).toBe(solo);
      // One app with workflows listed: other workflows are not its deploys.
      expect((pickAppMapping('workflow_run', { workflow_run: { name: 'Docs' } }, [fe]) as any).reason).toMatch(/belongs to none/);
    });
    it('appWorkflowsProblem', () => {
      expect(appWorkflowsProblem(fe, [])).toBeNull();
      expect(appWorkflowsProblem(fe, [be])).toBeNull();
      expect(appWorkflowsProblem({ ...be, appWorkflows: [] }, [fe])).toMatch(/LMS Backend/);
      expect(appWorkflowsProblem({ ...be, appWorkflows: ['FRONTEND CI/CD'] }, [fe])).toMatch(/already LMS Frontend's/);
    });
  });
});
