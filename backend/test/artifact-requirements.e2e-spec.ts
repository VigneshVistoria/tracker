import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Artifact types Stage 3 (2026-11-06): required types per role are enforced
// at Ready for Feedback (qa-submit) and Peer Review submit, with a 400 that
// names the missing types. Nothing is required until a rule says so.
describe('Required artifact types (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let designer: FixtureUser;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const put = (u: FixtureUser, url: string, body: any = {}) => http().put(url).set(auth(u)).send(body);
  const art = (type: string) => ({ type, url: `https://example.com/${encodeURIComponent(type)}` });
  const rounds = async (id: number) => (await ds.query(`SELECT count(*)::int n FROM task_qa_reviews WHERE "taskId" = $1`, [id]))[0].n;

  const newTask = async (assignee: FixtureUser, values: Record<string, any> = {}) => {
    seq += 1;
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pA,
      projectName: 'Project A',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'Build',
      title: `Required types ${seq}`,
      description: 'x',
      status: 'Development',
      estimatedHours: 4,
      dueDate: '2026-12-31',
      assigneeUserId: assignee.id,
      assigneeEmail: assignee.email,
      createdByUserId: f.users.pm.id,
      createdByEmail: f.users.pm.email,
      ...values,
    };
    const cols = Object.keys(row);
    const res = await ds.query(
      `INSERT INTO project_tasks (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return res[0].id as number;
  };
  const qaSubmit = (u: FixtureUser, id: number, types: string[]) =>
    post(u, `/tasks/${id}/qa-submit`, { resolution: '<p>Done</p>', actualHours: 2, artifacts: types.map(art) });
  const peerSubmit = (u: FixtureUser, id: number, types: string[]) =>
    post(u, `/tasks/${id}/peer-review-submit`, { resolution: '<p>Done</p>', actualHours: 2, artifacts: types.map(art), reviewerUserId: f.users.devNone.id });

  const typeId = async (code: string) => {
    await get(f.users.pm, '/submission-checklist/artifact-types').expect(200); // seeds the tenant on first read
    return (await ds.query(`SELECT id FROM artifact_types WHERE "tenantId" = $1 AND code = $2`, [f.tenants.t1, code]))[0].id as number;
  };
  const setRules = async (role: string, rules: Array<[string, 'optional' | 'required']>) => {
    const body = { rules: await Promise.all(rules.map(async ([code, requirement]) => ({ artifactTypeId: await typeId(code), requirement }))) };
    await put(f.users.pm, `/submission-checklist/artifact-rules/${role}`, body).expect(200);
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_qa_review_artifacts, task_dependency_tickets, task_blocking_defects, artifact_types, artifact_type_rules, audit_logs, team_settings RESTART IDENTITY CASCADE`,
    );
    await ds.query(`UPDATE projects SET "submissionChecklistEnabled" = false, "pmReviewEnabled" = false`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    const d = (
      await ds.query(
        `INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, 'designer@test.local', 'x', 'Name designer', 'designer') RETURNING id`,
        [f.tenants.t1],
      )
    )[0];
    await ds.query(`INSERT INTO user_projects ("usersId", "projectsId") VALUES ($1, $2)`, [d.id, f.projects.pA]);
    designer = { id: d.id, email: 'designer@test.local', tenantId: f.tenants.t1, role: 'designer' };
  });

  afterAll(async () => {
    await app.close();
  });

  it('with no rules, any artifact is accepted - unchanged behaviour', async () => {
    await qaSubmit(f.users.devA, await newTask(f.users.devA), ['Screenshot']).expect(201);
    await peerSubmit(f.users.devA, await newTask(f.users.devA, { peerReviewEnabled: true }), ['Screenshot']).expect(201);
  });

  it('optional-only rules never refuse a submission', async () => {
    await setRules('developer', [
      ['Pull Request Link', 'optional'],
      ['Demo Video', 'optional'],
    ]);
    await qaSubmit(f.users.devA, await newTask(f.users.devA), ['Screenshot']).expect(201);
  });

  it('Ready for Feedback is refused when a required type is missing, naming it; nothing is saved', async () => {
    await setRules('developer', [
      ['Pull Request Link', 'required'],
      ['Demo Video', 'required'],
      ['Screenshot', 'optional'],
    ]);
    const id = await newTask(f.users.devA);
    const one = await qaSubmit(f.users.devA, id, ['Screenshot', 'Pull Request Link']).expect(400);
    expect(one.body.message).toBe('"Demo Video" is a required artifact type for your role - add it and submit again.');
    const both = await qaSubmit(f.users.devA, id, ['Screenshot']).expect(400);
    expect(both.body.message).toBe('"Pull Request Link" and "Demo Video" are required artifact types for your role - add them and submit again.');
    expect(await rounds(id)).toBe(0);
    expect((await ds.query(`SELECT status FROM project_tasks WHERE id = $1`, [id]))[0].status).toBe('Development');
    await qaSubmit(f.users.devA, id, ['Pull Request Link', 'Demo Video']).expect(201);
    expect(await rounds(id)).toBe(1);
  });

  it('Peer Review is refused the same way', async () => {
    const id = await newTask(f.users.devA, { peerReviewEnabled: true });
    const res = await peerSubmit(f.users.devA, id, ['Demo Video']).expect(400);
    expect(res.body.message).toBe('"Pull Request Link" is a required artifact type for your role - add it and submit again.');
    expect(await rounds(id)).toBe(0);
    await peerSubmit(f.users.devA, id, ['Demo Video', 'Pull Request Link']).expect(201);
  });

  it('the message uses the renamed label; an inactive type is never required', async () => {
    // Technical Documentation: not one of the checklist's link/evidence
    // types, so it may be deactivated.
    await setRules('developer', [
      ['Pull Request Link', 'required'],
      ['Technical Documentation', 'required'],
    ]);
    const doc = await typeId('Technical Documentation');
    await patch(f.users.pm, `/submission-checklist/artifact-types/${doc}`, { label: 'Design notes' }).expect(200);
    const id = await newTask(f.users.devA);
    const res = await qaSubmit(f.users.devA, id, ['Pull Request Link']).expect(400);
    expect(res.body.message).toBe('"Design notes" is a required artifact type for your role - add it and submit again.');
    await patch(f.users.pm, `/submission-checklist/artifact-types/${doc}`, { active: false }).expect(200);
    await qaSubmit(f.users.devA, id, ['Pull Request Link']).expect(201);
    await patch(f.users.pm, `/submission-checklist/artifact-types/${doc}`, { active: true }).expect(200);
  });

  it("rules apply to the submitter's own role only", async () => {
    // Developer rules don't bind a Designer...
    await qaSubmit(designer, await newTask(designer), ['Prototype']).expect(201);
    // ...and Designer rules bind the Designer, not the Developer.
    await setRules('developer', []);
    await setRules('designer', [['Design file', 'required']]);
    const res = await qaSubmit(designer, await newTask(designer), ['Prototype']).expect(400);
    expect(res.body.message).toBe('"Design file" is a required artifact type for your role - add it and submit again.');
    await qaSubmit(f.users.devA, await newTask(f.users.devA), ['Screenshot']).expect(201);
  });

  it("another tenant's rules never apply", async () => {
    await setRules('designer', []);
    // Tenant 2 requires Design file for designers; tenant 1 has no rules.
    await get(f.users.pmT2, '/submission-checklist/artifact-types').expect(200);
    const t2Type = (await ds.query(`SELECT id FROM artifact_types WHERE "tenantId" = $1 AND code = 'Design file'`, [f.tenants.t2]))[0].id;
    await put(f.users.pmT2, '/submission-checklist/artifact-rules/designer', { rules: [{ artifactTypeId: t2Type, requirement: 'required' }] }).expect(200);
    await qaSubmit(designer, await newTask(designer), ['Prototype']).expect(201);
  });
});
