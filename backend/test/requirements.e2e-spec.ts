import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { REQUIREMENTS_AUDIT } from '../src/requirements/requirements';

// Requirements traceability Stage 1 (2026-11-25): switch, roles + project
// scoping, the tree and its roll-ups, Pass/Fail with history and audit, and
// Blocker / dependency flags read from linked tickets (never written).
describe('Requirements tree (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let srsId: number;
  let qaOff: FixtureUser;
  let taskId: number;

  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => request(app.getHttpServer()).get(url).set(auth(u));
  const put = (u: FixtureUser, url: string, body: any) => request(app.getHttpServer()).put(url).set(auth(u)).send(body);
  const setSwitch = (u: FixtureUser, on: boolean) => put(u, '/requirements/settings', { requirementsTree: on });
  const tree = async (u: FixtureUser = f.users.pm) => (await get(u, `/requirements/srs/${srsId}/tree`).expect(200)).body;
  const story = (t: any, code: string) => t.epics.flatMap((e: any) => e.stories).find((s: any) => s.code === code);
  const criterionId = async (code: string, position: number) =>
    (await ds.query(`SELECT c.id FROM srs_criteria c JOIN srs_stories s ON s.id = c."storyId" WHERE s.code = $1 AND c.position = $2`, [code, position]))[0].id as number;
  const result = (u: FixtureUser, id: number, body: any) => put(u, `/requirements/criteria/${id}/result`, body);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE team_settings, audit_logs RESTART IDENTITY CASCADE`);
    // The real seed, aimed at the fixture LMS project and its PM.
    const seed = fs
      .readFileSync(path.resolve(__dirname, '../migrations/2026-11-requirements-s1-seed.sql'), 'utf8')
      .replace(/^BEGIN;$/m, '')
      .replace(/^COMMIT;$/m, '')
      .replace('v_project integer := 6; -- SEED_PROJECT', `v_project integer := ${f.projects.pLms};`)
      .replace(`v_reviewer_pattern text := 'Vignesh%'; -- SEED_REVIEWER`, `v_reviewer_pattern text := 'Name pm';`);
    await ds.query(seed);
    srsId = (await ds.query(`SELECT id FROM srs_documents`))[0].id;
    // A QA who is not on LMS.
    const [q] = await ds.query(`INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, 'qaoff@test.local', 'x', 'Name qaOff', 'qa') RETURNING id`, [f.tenants.t1]);
    await ds.query(`INSERT INTO user_projects ("usersId", "projectsId") VALUES ($1, $2)`, [q.id, f.projects.pB]);
    qaOff = { id: q.id, email: 'qaoff@test.local', tenantId: f.tenants.t1, role: 'qa' };
    // One LMS ticket, linked later.
    const [m] = await ds.query(`SELECT id FROM modules WHERE "projectId" = $1 LIMIT 1`, [f.projects.pLms]);
    const [ph] = await ds.query(`INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", name) VALUES ($1, $2, 'LMS', $3, 'LMS Module', 'Build') RETURNING id`, [
      f.tenants.t1,
      f.projects.pLms,
      m.id,
    ]);
    const [task] = await ds.query(
      `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", title, description, status, "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
       VALUES ($1, $2, 'LMS', $3, 'LMS Module', $4, 'Build', 'Approve lien and lock deed', 'x', 'Development', $5, $6, $7, $8) RETURNING id`,
      [f.tenants.t1, f.projects.pLms, m.id, ph.id, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
    );
    taskId = task.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('switch OFF: the feature does not exist (404), /me says off', async () => {
    expect((await get(f.users.admin, '/requirements/me').expect(200)).body).toEqual({ on: false, canView: false, canRecordResults: false, canManageSettings: true, isBa: false });
    expect((await get(f.users.qaB, '/requirements/me').expect(200)).body).toEqual({ on: false, canView: false, canRecordResults: false, canManageSettings: false, isBa: false });
    await get(f.users.admin, '/requirements/srs').expect(404);
    await get(f.users.admin, `/requirements/srs/${srsId}/tree`).expect(404);
    await result(f.users.pm, await criterionId('US-01', 1), { result: 'pass' }).expect(404);
  });

  it('only Admin and PM change the switch, and it is audited', async () => {
    for (const u of [f.users.exec, f.users.qaB, f.users.devA]) {
      await get(u, '/requirements/settings').expect(403);
      await setSwitch(u, true).expect(403);
    }
    await setSwitch(f.users.pm, 'yes' as any).expect(400);
    expect((await setSwitch(f.users.pm, true).expect(200)).body).toEqual({ requirementsTree: true });
    const [a] = await ds.query(`SELECT "userId", details FROM audit_logs WHERE action = $1`, [REQUIREMENTS_AUDIT.SETTINGS_UPDATED]);
    expect(a.userId).toBe(f.users.pm.id);
    expect(JSON.parse(a.details)).toEqual({ before: { requirementsTree: false }, after: { requirementsTree: true } });
    expect((await get(f.users.qaB, '/requirements/me').expect(200)).body).toEqual({ on: true, canView: true, canRecordResults: true, canManageSettings: false, isBa: false });
    expect((await get(f.users.exec, '/requirements/me').expect(200)).body).toMatchObject({ on: true, canView: true, canRecordResults: false });
    expect((await get(f.users.devA, '/requirements/me').expect(200)).body).toMatchObject({ on: true, canView: false });
  });

  it('who sees what: Admin/PM/Exec all, QA only their projects, developers none, other tenants none', async () => {
    for (const u of [f.users.admin, f.users.pm, f.users.exec, f.users.qaB]) {
      const list = (await get(u, '/requirements/srs').expect(200)).body;
      expect(list).toEqual([expect.objectContaining({ id: srsId, projectName: 'LMS', version: '1.0', status: 'in_review', issuedOn: '2026-11-16' })]);
      await get(u, `/requirements/srs/${srsId}/tree`).expect(200);
    }
    expect((await get(qaOff, '/requirements/srs').expect(200)).body).toEqual([]);
    await get(qaOff, `/requirements/srs/${srsId}/tree`).expect(404);
    await get(f.users.devA, '/requirements/srs').expect(403);
    await get(f.users.devA, `/requirements/srs/${srsId}/tree`).expect(403);
    await get(f.users.clientA, '/requirements/srs').expect(403);
    // Tenant 2: switch it ON there too - still never sees tenant 1's SRS.
    await setSwitch(f.users.pmT2, true).expect(200);
    expect((await get(f.users.pmT2, '/requirements/srs').expect(200)).body).toEqual([]);
    await get(f.users.pmT2, `/requirements/srs/${srsId}/tree`).expect(404);
  });

  it('the tree: SRS -> 6 epics -> 23 stories -> criteria, all 0%, Draft, no tickets', async () => {
    const t = await tree();
    expect(t.srs).toMatchObject({
      name: 'Lien, Litigation & Court Collateral',
      version: '1.0',
      status: 'in_review',
      issuedOn: '2026-11-16',
      projectName: 'LMS',
      reviewers: ['Name pm'],
      requirementCount: 40,
      epicCount: 6,
      storyCount: 23,
      percent: 0,
      storiesDone: 0,
    });
    expect(t.summary).toEqual({ percent: 0, criteriaPassed: 0, criteriaTotal: 65, storiesDone: 0, storiesTotal: 23, storiesFailed: 0, storiesBlocked: 0, storiesWaiting: 0 });
    expect(t.epics.map((e: any) => e.code)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
    expect(t.epics.map((e: any) => e.stories.length)).toEqual([6, 4, 2, 3, 6, 2]);
    const us02 = story(t, 'US-02');
    expect(us02).toMatchObject({ title: 'Capture relationship and owner consent', status: 'draft', requirements: ['LN-09', 'LN-10', 'LN-11'], percent: 0, passed: 0, total: 4, state: 'no_tickets', tickets: [], blockedBy: [], dependsOn: [] });
    expect(us02.criteria.map((c: any) => [c.position, c.result])).toEqual([
      [1, 'not_run'],
      [2, 'not_run'],
      [3, 'not_run'],
      [4, 'not_run'],
    ]);
    expect(t.permissions).toMatchObject({ canRecordResults: true });
    expect((await tree(f.users.exec)).permissions).toMatchObject({ canRecordResults: false });
  });

  it('Pass/Fail: QA/PM/Admin only, on their projects, Approved stories only (Stage 2); Fail needs 10+ characters', async () => {
    const ac1 = await criterionId('US-01', 1);
    await result(f.users.exec, ac1, { result: 'pass' }).expect(403);
    await result(f.users.devA, ac1, { result: 'pass' }).expect(403);
    await result(qaOff, ac1, { result: 'pass' }).expect(404);
    await result(f.users.pmT2, ac1, { result: 'pass' }).expect(404);
    // Draft story: refused from Stage 2.
    const draft = await result(f.users.qaB, ac1, { result: 'pass' }).expect(400);
    expect(draft.body.message).toMatch(/Only Approved stories/);
    await ds.query(`UPDATE srs_stories SET status = 'approved' WHERE code = 'US-01'`);
    await result(f.users.qaB, ac1, { result: 'maybe' }).expect(400);
    const short = await result(f.users.qaB, ac1, { result: 'fail', note: '  too short ' }).expect(400);
    expect(short.body.message).toMatch(/at least 10/);
    await result(f.users.qaB, 999999, { result: 'pass' }).expect(404);
    expect(Number((await ds.query(`SELECT count(*) n FROM srs_criterion_results`))[0].n)).toBe(0);
  });

  it('passing every criterion of an Approved story: 100%, Done, history + audit', async () => {
    for (let p = 1; p <= 5; p++) await result(p % 2 ? f.users.qaB : f.users.admin, await criterionId('US-01', p), { result: 'pass' }).expect(200);
    const t = await tree();
    const us01 = story(t, 'US-01');
    expect(us01).toMatchObject({ percent: 100, passed: 5, total: 5, state: 'done', status: 'done' });
    expect(us01.criteria.every((c: any) => c.result === 'pass' && c.beforeApproval === false)).toBe(true);
    expect(t.epics[0].percent).toBe(17); // (100 + 0*5) / 6
    expect(t.summary).toMatchObject({ percent: 4, criteriaPassed: 5, storiesDone: 1 }); // 100 / 23
    expect(t.srs).toMatchObject({ percent: 4, storiesDone: 1 });
    const history = await ds.query(`SELECT result, "storyStatus", "beforeApproval", "recordedByUserId" FROM srs_criterion_results ORDER BY id`);
    expect(history).toHaveLength(5);
    expect(history[0]).toEqual({ result: 'pass', storyStatus: 'approved', beforeApproval: false, recordedByUserId: f.users.qaB.id });
    expect(Number((await ds.query(`SELECT count(*) n FROM audit_logs WHERE action = $1`, [REQUIREMENTS_AUDIT.CRITERION_RESULT]))[0].n)).toBe(5);
  });

  it('a Fail keeps its reason, shows as failed, and is counted; history keeps both results', async () => {
    const ac2 = await criterionId('US-01', 2);
    await result(f.users.qaB, ac2, { result: 'fail', note: '  Customer still filled from title deed  ' }).expect(200);
    const t = await tree();
    const us01 = story(t, 'US-01');
    expect(us01).toMatchObject({ percent: 80, state: 'failed', status: 'in_progress' });
    expect(us01.criteria[1]).toMatchObject({ result: 'fail', note: 'Customer still filled from title deed' });
    expect(t.summary).toMatchObject({ storiesFailed: 1, storiesDone: 0 });
    const rows = await ds.query(`SELECT result, note FROM srs_criterion_results WHERE "criterionId" = $1 ORDER BY id`, [ac2]);
    expect(rows).toEqual([
      { result: 'pass', note: null },
      { result: 'fail', note: 'Customer still filled from title deed' },
    ]);
    const [a] = await ds.query(`SELECT details FROM audit_logs WHERE action = $1 AND "entityId" = $2 ORDER BY id DESC LIMIT 1`, [REQUIREMENTS_AUDIT.CRITERION_RESULT, ac2]);
    expect(JSON.parse(a.details)).toMatchObject({ story: 'US-01', criterion: 'AC2', before: 'pass', after: 'fail', beforeApproval: false });
  });

  it('results recorded before approval (Stage 1) keep their "before approval" flag', async () => {
    const id = await criterionId('US-06', 1);
    await ds.query(`UPDATE srs_criteria SET result = 'pass', "resultByUserId" = $2, "resultAt" = now(), "resultBeforeApproval" = true WHERE id = $1`, [id, f.users.qaB.id]);
    const s = story(await tree(), 'US-06');
    expect(s.criteria[0]).toMatchObject({ result: 'pass', beforeApproval: true });
    expect(s.status).toBe('draft');
  });

  it('an Approved story moves to In progress and Done automatically, and back on a Fail', async () => {
    await ds.query(`UPDATE srs_stories SET status = 'approved' WHERE code = 'US-04'`);
    await result(f.users.qaB, await criterionId('US-04', 1), { result: 'pass' }).expect(200);
    expect(story(await tree(), 'US-04')).toMatchObject({ status: 'in_progress', state: 'progress' });
    await result(f.users.qaB, await criterionId('US-04', 2), { result: 'pass' }).expect(200);
    expect(story(await tree(), 'US-04')).toMatchObject({ status: 'done', state: 'done', percent: 100 });
    const [h] = await ds.query(`SELECT "beforeApproval", "storyStatus" FROM srs_criterion_results WHERE "storyId" = (SELECT id FROM srs_stories WHERE code = 'US-04') ORDER BY id DESC LIMIT 1`);
    expect(h).toEqual({ beforeApproval: false, storyStatus: 'in_progress' });
    await result(f.users.pm, await criterionId('US-04', 2), { result: 'fail', note: 'Duplicate priority accepted' }).expect(200);
    expect(story(await tree(), 'US-04')).toMatchObject({ status: 'in_progress', state: 'failed' });
  });

  it('linked tickets show with Blocker and dependency flags while open, and the ticket is never changed', async () => {
    const before = (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [taskId]))[0];
    const us03 = (await ds.query(`SELECT id FROM srs_stories WHERE code = 'US-03'`))[0].id;
    await ds.query(`INSERT INTO srs_story_tickets ("tenantId", "storyId", "taskId", kind, "linkedByUserId") VALUES ($1, $2, $3, 'dev', $4), ($1, $2, $3, 'qa', $4)`, [
      f.tenants.t1,
      us03,
      taskId,
      f.users.pm.id,
    ]);
    await ds.query(`UPDATE srs_stories SET status = 'approved' WHERE code = 'US-03'`);
    let s = story(await tree(), 'US-03');
    expect(s.tickets).toEqual([
      expect.objectContaining({ taskId, trk: `TRK-${taskId}`, kind: 'dev', title: 'Approve lien and lock deed', status: 'Development', assignee: 'Name devA', criterionIds: [] }),
      expect.objectContaining({ taskId, trk: `TRK-${taskId}`, kind: 'qa', title: 'Approve lien and lock deed', status: 'Development', assignee: 'Name devA', criterionIds: [] }),
    ]);
    expect(s.state).toBe('progress');

    const [flag] = await ds.query(
      `INSERT INTO task_flags ("tenantId", "taskId", "projectId", kind, reason, "blockingOwnerExternal", external, "setByUserId", "setByAssignee") VALUES ($1, $2, $3, 'blocker', 'Waiting for client decision on deed lock', 'Client', true, $4, true) RETURNING id`,
      [f.tenants.t1, taskId, f.projects.pLms, f.users.devA.id],
    );
    const [dep] = await ds.query(
      `INSERT INTO task_dependency_tickets ("tenantId", "parentTaskId", title, description, "ownerUserId", "ownerEmail", "createdByUserId", "createdByEmail", status) VALUES ($1, $2, 'Notification service API', 'x', $3, $4, $3, $4, 'open') RETURNING id`,
      [f.tenants.t1, taskId, f.users.devA.id, f.users.devA.email],
    );
    let t = await tree();
    s = story(t, 'US-03');
    expect(s.state).toBe('blocked');
    expect(s.blockedBy).toEqual([{ trk: `TRK-${taskId}`, reason: 'Waiting for client decision on deed lock' }]);
    expect(s.dependsOn).toEqual([{ trk: `TRK-${taskId}`, title: 'Notification service API' }]);
    expect(t.summary).toMatchObject({ storiesBlocked: 1, storiesWaiting: 1 });

    await ds.query(`UPDATE task_flags SET "clearedAt" = now(), "clearedByUserId" = $2 WHERE id = $1`, [flag.id, f.users.pm.id]);
    s = story(await tree(), 'US-03');
    expect(s).toMatchObject({ state: 'dependency', blockedBy: [] });

    await ds.query(`UPDATE task_dependency_tickets SET status = 'resolved', "resolvedAt" = now() WHERE id = $1`, [dep.id]);
    t = await tree();
    expect(story(t, 'US-03')).toMatchObject({ state: 'progress', dependsOn: [] });
    expect(t.summary).toMatchObject({ storiesBlocked: 0, storiesWaiting: 0 });

    // Pass/Fail on a story with a linked ticket leaves the ticket untouched.
    await result(f.users.qaB, await criterionId('US-03', 1), { result: 'pass' }).expect(200);
    const after = (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [taskId]))[0];
    expect(after).toEqual(before);
  });
});
