import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// QA Review defects (2026-10-13): GET /tasks/qa-queue?include=defects also
// lists defects waiting on a QA retest, for the QA who raised them (all
// of them for Admin/PM, none for Executive). Without the flag the queue is
// unchanged, so the Dashboard's numbers stay tasks-only.
describe('QA Review: defects submitted for retest (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let qaOther: FixtureUser;
  const ids: Record<string, number> = {};

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const statusOf = async (id: number) => (await ds.query(`SELECT status FROM project_tasks WHERE id = $1`, [id]))[0].status;

  const artifacts = [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }];
  const qaSubmit = (u: FixtureUser, id: number) => post(u, `/tasks/${id}/qa-submit`, { resolution: 'Done', actualHours: 2, artifacts });
  const queue = async (u: FixtureUser, query = '?include=defects') => (await get(u, `/tasks/qa-queue${query}`).expect(200)).body;
  const idsOf = (body: any) => body.tasks.map((t: any) => t.id);

  const task = async (key: string, values: Record<string, any>) => {
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pA,
      projectName: 'Project A',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'Build',
      title: `Task ${key}`,
      description: 'x',
      status: 'Development',
      estimatedHours: 4,
      dueDate: '2026-12-31',
      assigneeUserId: f.users.devA.id,
      assigneeEmail: f.users.devA.email,
      createdByUserId: f.users.pm.id,
      createdByEmail: f.users.pm.email,
      ...values,
    };
    const cols = Object.keys(row);
    const res = await ds.query(
      `INSERT INTO project_tasks (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    ids[key] = res[0].id;
  };
  const defectBy = (qa: FixtureUser, values: Record<string, any> = {}) => ({
    isDefect: true,
    createdByUserId: qa.id,
    createdByEmail: qa.email,
    ...values,
  });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_blocking_defects, user_notifications, audit_logs RESTART IDENTITY CASCADE`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    const otherId = (
      await ds.query(
        `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, 'qaOther@test.local', 'x', 'Name qaOther', 'qa') RETURNING id`,
        [f.tenants.t1],
      )
    )[0].id;
    qaOther = { id: otherId, email: 'qaOther@test.local', tenantId: f.tenants.t1, role: 'qa' };

    await task('task', {});
    await task('defect', defectBy(f.users.qaB));
    await task('otherDefect', defectBy(qaOther));
    await task('heldDefect', defectBy(f.users.qaB, { status: 'Hold', priorStatus: 'Feedback' }));
    await task('junkDefect', defectBy(f.users.qaB, { status: 'Junk', statusBeforeJunk: 'Feedback' }));

    await qaSubmit(f.users.devA, ids.task).expect(201);
    await qaSubmit(f.users.devA, ids.defect).expect(201);
    await qaSubmit(f.users.devA, ids.otherDefect).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the guards: 401 without login, 403 for a Developer', async () => {
    await http().get('/tasks/qa-queue?include=defects').expect(401);
    await get(f.users.devA, '/tasks/qa-queue?include=defects').expect(403);
  });

  it('without the flag the queue is unchanged: tasks only', async () => {
    const body = await queue(f.users.qaB, '');
    expect(idsOf(body)).toEqual([ids.task]);
    expect(body.statCounts).toMatchObject({ pending: 1, resubmissions: 0, approved: 0, rejected: 0 });
  });

  it('a QA sees tasks plus only the defects they raised, each once, count matching the list', async () => {
    const body = await queue(f.users.qaB);
    expect(idsOf(body).sort()).toEqual([ids.task, ids.defect].sort());
    expect(body.statCounts.pending).toBe(body.tasks.length);
    expect((await queue(qaOther)).tasks.map((t: any) => t.id).sort()).toEqual([ids.task, ids.otherDefect].sort());
  });

  it('never lists Hold or Junk defects', async () => {
    for (const u of [f.users.qaB, f.users.pm]) {
      const listed = idsOf(await queue(u));
      expect(listed).not.toContain(ids.heldDefect);
      expect(listed).not.toContain(ids.junkDefect);
    }
  });

  it('Admin and PM see every defect; Executive stays tasks-only', async () => {
    for (const u of [f.users.pm, f.users.admin]) {
      const body = await queue(u);
      expect(idsOf(body).sort()).toEqual([ids.task, ids.defect, ids.otherDefect].sort());
      expect(body.statCounts.pending).toBe(3);
    }
    const exec = await queue(f.users.exec);
    expect(idsOf(exec)).toEqual([ids.task]);
    expect(exec.statCounts.pending).toBe(1);
  });

  it('only the raising QA can decide the defect', async () => {
    await patch(qaOther, `/tasks/${ids.defect}/qa-reject`, { comment: 'not mine' }).expect(403);
    await patch(qaOther, `/tasks/${ids.defect}/qa-approve`, {}).expect(403);
    expect(await statusOf(ids.defect)).toBe('Feedback');
  });

  it('fail: leaves the pending list and shows under Rejected; resubmit brings it back', async () => {
    await patch(f.users.qaB, `/tasks/${ids.defect}/qa-reject`, { comment: 'Still broken' }).expect(200);
    expect(await statusOf(ids.defect)).toBe('Failed');
    let body = await queue(f.users.qaB);
    expect(idsOf(body)).toEqual([ids.task]);
    expect(body.statCounts).toMatchObject({ pending: 1, rejected: 1 });
    expect(idsOf(await queue(f.users.qaB, '?include=defects&status=Failed'))).toEqual([ids.defect]);

    await qaSubmit(f.users.devA, ids.defect).expect(201);
    body = await queue(f.users.qaB);
    expect(idsOf(body).sort()).toEqual([ids.task, ids.defect].sort());
    expect(body.statCounts).toMatchObject({ pending: 2, resubmissions: 1, rejected: 0 });
  });

  it('pass: leaves the pending list and shows under Approved', async () => {
    await patch(f.users.qaB, `/tasks/${ids.defect}/qa-approve`, {}).expect(200);
    expect(await statusOf(ids.defect)).toBe('Pass');
    const body = await queue(f.users.qaB);
    expect(idsOf(body)).toEqual([ids.task]);
    expect(body.statCounts).toMatchObject({ pending: 1, approved: 1 });
    expect(idsOf(await queue(f.users.qaB, '?include=defects&status=Pass'))).toEqual([ids.defect]);
    // Still tasks-only without the flag.
    expect((await queue(f.users.qaB, '?status=Pass')).tasks).toEqual([]);
  });
});
