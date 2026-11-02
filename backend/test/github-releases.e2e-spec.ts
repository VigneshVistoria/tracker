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
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

const SECRET = 'test-webhook-secret';
const REPO = 'Vistoria/claims-app';
const SHA_RC = '1'.repeat(40);
const SHA_1 = '2'.repeat(40);
const SHA_2 = '3'.repeat(40);

// P1/P2 from GitHub (2026-11-02): the signed webhook, the switch, the
// repository mapping, releases created or filled in (never overwritten),
// staging dates, Released by via GitHub username, and tasks from PR titles
// through the GitHub App's read access (a local stand-in for api.github.com).
describe('GitHub releases (P1/P2 from GitHub, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let github: GithubReleasesService;
  let api: Server;
  let apiCalls: string[] = [];
  let phaseId: number;
  let mappingId: number;
  const tasks: Record<string, number> = {};

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  let seq = 0;
  const deliver = (event: string, payload: any, opts: { secret?: string | null; id?: string } = {}) => {
    const body = JSON.stringify({ installation: { id: 77 }, repository: { full_name: REPO }, ...payload });
    const req = http()
      .post('/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', event)
      .set('X-GitHub-Delivery', opts.id ?? `d-${++seq}`);
    if (opts.secret !== null) req.set('X-Hub-Signature-256', `sha256=${createHmac('sha256', opts.secret ?? SECRET).update(body).digest('hex')}`);
    return req.send(body);
  };
  const lastDelivery = async () => (await ds.query(`SELECT * FROM github_webhook_deliveries ORDER BY id DESC LIMIT 1`))[0];
  const release = (tag: string, prerelease: boolean, publishedAt: string, name = '') => ({
    action: 'published',
    release: { tag_name: tag, prerelease, draft: false, name, author: { login: 'Dev-A' }, published_at: publishedAt },
  });
  const newTask = async (title: string, projectId: number, withResolution: boolean) => {
    const id = (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "isDefect")
         VALUES ($1, $2, 'P', $3, 'M', $4, 'Build', $5, 'x', 'Pass', $6, $7, $8, $9, false) RETURNING id`,
        [f.tenants.t1, projectId, f.modules.mA, phaseId, title, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
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

  beforeAll(async () => {
    // A stand-in for api.github.com: the App token, tags, compare, PRs.
    api = createServer((req, res) => {
      apiCalls.push(`${req.method} ${req.url}`);
      const json = (body: any, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/app/installations/77/access_tokens' && req.method === 'POST') {
        if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(req.headers.authorization || '')) return json({ message: 'no jwt' }, 401);
        return json({ token: 'inst-token', expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      if (req.headers.authorization !== 'Bearer inst-token') return json({ message: 'bad token' }, 401);
      const tagShas: Record<string, string> = { 'v1.0.0-rc.1': SHA_RC, 'v1.0.0': SHA_1, 'v1.1.0': SHA_2 };
      const m = req.url!.match(/^\/repos\/Vistoria\/claims-app\/commits\/([^/]+)$/);
      if (m && tagShas[decodeURIComponent(m[1])]) return json({ sha: tagShas[decodeURIComponent(m[1])], commit: { message: 'Release' } });
      if (m && m[1] === SHA_1) return json({ sha: SHA_1, commit: { message: `TRK-${tasks.first} first release` } });
      if (req.url === `/repos/Vistoria/claims-app/compare/${SHA_1}...${SHA_2}`) {
        return json({ total_commits: 2, commits: [{ sha: 'c1', commit: { message: 'Squashed thing' } }, { sha: 'c2', commit: { message: 'Another' } }] });
      }
      if (req.url === '/repos/Vistoria/claims-app/commits/c1/pulls') return json([{ number: 5, title: `TRK-${tasks.withRes} Add claims export`, head: { ref: `feature/TRK-${tasks.noRes}-wip` } }]);
      if (req.url === '/repos/Vistoria/claims-app/commits/c2/pulls') return json([{ number: 6, title: `TRK-${tasks.otherProject} and TRK-999999 and #${tasks.junk}`, head: { ref: 'fix' } }]);
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

    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    github = app.get(GithubReleasesService);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, releases, release_items, audit_logs, github_settings, github_repo_mappings, github_webhook_deliveries, github_staging_deployments RESTART IDENTITY CASCADE`,
    );
    phaseId = (
      await ds.query(`INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`, [
        f.tenants.t1,
        f.projects.pA,
        f.modules.mA,
      ])
    )[0].id;
    tasks.first = await newTask('First', f.projects.pA, true);
    tasks.withRes = await newTask('Export', f.projects.pA, true);
    tasks.noRes = await newTask('Not submitted yet', f.projects.pA, false);
    tasks.otherProject = await newTask('Elsewhere', f.projects.pB, true);
    tasks.junk = await newTask('Junked', f.projects.pA, true);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => api?.close(resolve));
    for (const k of ['GITHUB_WEBHOOK_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY_PATH', 'GITHUB_API_URL']) delete process.env[k];
  });

  it('refuses unsigned and wrongly signed deliveries, and logs them', async () => {
    await deliver('ping', {}, { secret: null }).expect(401);
    expect(await lastDelivery()).toMatchObject({ signatureValid: false, outcome: 'refused', tenantId: null });
    await deliver('ping', {}, { secret: 'wrong' }).expect(401);
    const saved = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = '';
    await deliver('ping', {}).expect(503);
    process.env.GITHUB_WEBHOOK_SECRET = saved;
    expect(await lastDelivery()).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('secret is not set') });
  });

  it('an unmapped repository is ignored', async () => {
    await deliver('ping', {}).expect(202);
    expect(await lastDelivery()).toMatchObject({ signatureValid: true, outcome: 'ignored', tenantId: null });
  });

  it('settings and mappings: Admin and PM only, checked, audited', async () => {
    await http().get('/github-releases/settings').set(auth(f.users.devA)).expect(403);
    const { body: page } = await http().get('/github-releases/settings').set(auth(f.users.pm)).expect(200);
    expect(page).toMatchObject({ settings: { enabled: false, taskKeyPrefix: 'TRK' }, mappings: [], server: { webhookSecret: true, appReadAccess: true } });
    const base = { repoFullName: `https://github.com/${REPO}.git`, projectId: f.projects.pA, appName: 'Claims' };
    await http().post('/github-releases/mappings').set(auth(f.users.pm)).send({ ...base, repoFullName: 'not a repo' }).expect(400);
    await http().post('/github-releases/mappings').set(auth(f.users.pm)).send({ ...base, stagingBranches: ['main'], productionBranches: ['Main'] }).expect(400);
    await http().post('/github-releases/mappings').set(auth(f.users.pm)).send({ ...base, projectId: f.projects.pT2 }).expect(404);
    const { body: mapping } = await http().post('/github-releases/mappings').set(auth(f.users.pm)).send(base).expect(201);
    mappingId = mapping.id;
    expect(mapping).toMatchObject({ repoFullName: REPO, stagingEnvironments: ['staging'], productionEnvironments: ['production'], publishedReleaseIs: 'production', preReleaseIs: 'staging' });
    await http().post('/github-releases/mappings').set(auth(f.users.admin)).send({ ...base, repoFullName: 'vistoria/CLAIMS-app' }).expect(409);
    await http().patch('/github-releases/settings').set(auth(f.users.pm)).send({ taskKeyPrefix: 'trk-' }).expect(400);
    const audits = await ds.query(`SELECT action FROM audit_logs WHERE action LIKE 'github_%' ORDER BY id`);
    expect(audits.map((a: any) => a.action)).toEqual(['github_repo_mapping_created']);
  });

  it('while the switch is OFF, signed deliveries are only logged', async () => {
    await deliver('release', release('v0.9.0', false, '2026-11-01T08:00:00Z')).expect(202);
    expect(await lastDelivery()).toMatchObject({ tenantId: f.tenants.t1, outcome: 'ignored', reason: expect.stringContaining('switched off') });
    expect(await ds.query(`SELECT id FROM releases`)).toEqual([]);
  });

  it('Admin links GitHub usernames (Admin only, unique, checked, audited)', async () => {
    await http().patch(`/users/${f.users.devA.id}`).set(auth(f.users.pm)).send({ githubLogin: 'dev-a' }).expect(403);
    await http().patch(`/users/${f.users.devA.id}`).set(auth(f.users.admin)).send({ githubLogin: 'bad login!' }).expect(400);
    const { body } = await http().patch(`/users/${f.users.devA.id}`).set(auth(f.users.admin)).send({ githubLogin: '@dev-a' }).expect(200);
    expect(body.githubLogin).toBe('dev-a');
    await http().patch(`/users/${f.users.qaB.id}`).set(auth(f.users.admin)).send({ githubLogin: 'DEV-A' }).expect(409);
    const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'user_github_login_set'`);
    expect(JSON.parse(audit.details)).toEqual({ before: null, after: 'dev-a' });
  });

  it('switched on: a pre-release is staging, a published release creates the Release with tasks and Released by', async () => {
    await http().patch('/github-releases/settings').set(auth(f.users.pm)).send({ enabled: true }).expect(200);
    await deliver('release', release('v1.0.0-rc.1', true, '2026-11-01T08:00:00Z')).expect(202);
    await github.settled();
    expect(await lastDelivery()).toMatchObject({ outcome: 'processed', environment: 'staging' });
    await deliver('release', release('v1.0.0', false, '2026-11-02T08:00:00Z')).expect(202);
    await github.settled();
    const d = await lastDelivery();
    expect(d).toMatchObject({ outcome: 'processed', environment: 'production' });
    const [r] = await ds.query(`SELECT * FROM releases WHERE id = $1`, [d.releaseId]);
    expect(r).toMatchObject({
      source: 'github',
      appName: 'Claims',
      version: '1.0.0',
      githubRepo: REPO,
      githubSha: SHA_1,
      releasedByUserId: f.users.devA.id,
      githubReleasedByLogin: 'Dev-A',
      stagingSignedOffOn: null,
      stagingSignedOffByUserId: null,
      changeTicketRef: null,
    });
    expect(r.githubStagingDeployedOn).toBeTruthy();
    expect(r.githubFilled).toEqual(expect.arrayContaining(['releasedByUserId', 'githubStagingDeployedOn', 'items']));
    const items = await ds.query(`SELECT "taskId", "addedByUserId" FROM release_items WHERE "releaseId" = $1`, [r.id]);
    expect(items).toEqual([{ taskId: tasks.first, addedByUserId: null }]);
    // "published" and "released" arrive together for one release - no duplicate.
    await deliver('release', { ...release('v1.0.0', false, '2026-11-02T08:00:00Z'), action: 'released' }).expect(202);
    await github.settled();
    expect((await ds.query(`SELECT count(*)::int AS n FROM releases`))[0].n).toBe(1);
  });

  it('the same delivery twice is recorded once', async () => {
    await deliver('release', release('v1.0.0', false, '2026-11-02T08:00:00Z'), { id: 'same-id' }).expect(202);
    await github.settled();
    await deliver('release', release('v1.0.0', false, '2026-11-02T08:00:00Z'), { id: 'same-id' }).expect(200);
    expect(await lastDelivery()).toMatchObject({ outcome: 'duplicate' });
  });

  it('tasks come from PR titles and branches between releases; the ones that cannot go in are listed', async () => {
    await ds.query(`UPDATE project_tasks SET status = 'Junk' WHERE id = $1`, [tasks.junk]);
    apiCalls = [];
    await deliver('release', release('v1.1.0', false, '2026-11-03T08:00:00Z')).expect(202);
    await github.settled();
    expect(apiCalls).toContain(`GET /repos/Vistoria/claims-app/compare/${SHA_1}...${SHA_2}`);
    const [r] = await ds.query(`SELECT * FROM releases WHERE version = '1.1.0'`);
    const items = await ds.query(`SELECT "taskId" FROM release_items WHERE "releaseId" = $1`, [r.id]);
    expect(items).toEqual([{ taskId: tasks.withRes }]);
    expect(r.githubNotes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`^TRK-${tasks.noRes}: .*no Resolution yet`)),
        expect.stringMatching(new RegExp(`^TRK-${tasks.otherProject}: .*belongs to`)),
        expect.stringMatching(/^TRK-999999: .*not found/),
        expect.stringContaining('No staging deployment'),
      ]),
    );
    // A bare "#<number>" never links (that's GitHub's own numbering).
    expect(r.githubNotes.join(' ')).not.toContain(`TRK-${tasks.junk}`);
  });

  it('a Release the PM made first is only filled in, never overwritten; manual entry can not duplicate it', async () => {
    const [manual] = await ds.query(
      `INSERT INTO releases ("tenantId", "projectId", "projectName", "appName", version, "releaseDate", "changeTicketRef") VALUES ($1, $2, 'Project A', 'Claims', 'v2.0.0', '2026-10-30', 'CHG-1') RETURNING id`,
      [f.tenants.t1, f.projects.pA],
    );
    await deliver('deployment_status', {
      deployment_status: { state: 'success', created_at: '2026-11-04T09:00:00Z' },
      deployment: { environment: 'production', sha: '4'.repeat(40), ref: 'v2.0.0', creator: { login: 'someone-unknown' } },
    }).expect(202);
    await github.settled();
    const [r] = await ds.query(`SELECT *, "releaseDate"::text AS "releaseDate" FROM releases WHERE id = $1`, [manual.id]);
    expect(r).toMatchObject({ source: 'manual', version: 'v2.0.0', releaseDate: '2026-10-30', changeTicketRef: 'CHG-1', releasedByUserId: null, githubSha: '4'.repeat(40) });
    expect(r.githubNotes.join(' ')).toContain('"someone-unknown" isn\'t linked');
    expect((await ds.query(`SELECT count(*)::int AS n FROM releases WHERE version IN ('2.0.0', 'v2.0.0')`))[0].n).toBe(1);
    // The PM can't add 1.0.0 by hand as "v1.0.0" - GitHub already has it.
    const { body } = await http()
      .post('/releases')
      .set(auth(f.users.pm))
      .send({ projectId: f.projects.pA, appName: 'Claims', version: 'V1.0.0', releaseDate: '2026-11-02' })
      .expect(409);
    expect(body.message).toContain('already recorded from GitHub');
    // Same day, another name: created, with a possible-duplicate warning.
    const { body: twin } = await http().post('/releases').set(auth(f.users.pm)).send({ projectId: f.projects.pA, appName: 'Claims', version: 'Nov hotfix', releaseDate: '2026-11-03' }).expect(201);
    expect(twin.possibleDuplicateOf).toMatchObject({ version: '1.1.0' });
  });

  it('workflow runs count only for named deploy workflows; an inactive mapping is ignored', async () => {
    const run = { action: 'completed', workflow_run: { name: 'Deploy', head_branch: 'main', head_sha: '5'.repeat(40), conclusion: 'success', triggering_actor: { login: 'dev-a' } } };
    await deliver('workflow_run', run).expect(202);
    expect(await lastDelivery()).toMatchObject({ outcome: 'ignored', reason: expect.stringContaining('No deploy workflows') });
    await http().patch(`/github-releases/mappings/${mappingId}`).set(auth(f.users.pm)).send({ deployWorkflows: ['Deploy'], productionBranches: ['main'] }).expect(200);
    await deliver('workflow_run', run).expect(202);
    await github.settled();
    expect(await lastDelivery()).toMatchObject({ outcome: 'processed', environment: 'production' });
    expect((await ds.query(`SELECT count(*)::int AS n FROM releases WHERE version = 'sha-5555555'`))[0].n).toBe(1);
    await http().patch(`/github-releases/mappings/${mappingId}`).set(auth(f.users.pm)).send({ active: false }).expect(200);
    await deliver('workflow_run', run).expect(202);
    expect(await lastDelivery()).toMatchObject({ outcome: 'ignored', reason: expect.stringContaining('not active') });
  });

  it('the delivery log: PM sees their tenant, Admin also sees unmatched deliveries', async () => {
    const { body: pmView } = await http().get('/github-releases/deliveries').set(auth(f.users.pm)).expect(200);
    const { body: adminView } = await http().get('/github-releases/deliveries').set(auth(f.users.admin)).expect(200);
    expect(pmView.every((d: any) => d.tenantId === f.tenants.t1)).toBe(true);
    expect(adminView.some((d: any) => d.tenantId === null)).toBe(true);
    await http().get('/github-releases/deliveries').set(auth(f.users.pmT2)).expect(200).expect([]);
  });
});
