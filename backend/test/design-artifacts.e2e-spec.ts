import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Design artifact types (2026-11-05): a Designer's submission can attach a
// Design file, Prototype or Design spec; nothing else about submitting
// changes (each type once per submission, any assignee may use any type).
describe('Design artifact types (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let designer: FixtureUser;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });

  const newTask = async (assignee: FixtureUser) =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", title, description, status, "estimatedHours", "dueDate", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', 'Design the claims screen', 'x', 'Development', 4, '2026-12-31', $5, $6, $7, $8) RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, assignee.id, assignee.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;
  const submit = (u: FixtureUser, taskId: number, artifacts: Array<{ type: string; url: string }>) =>
    http().post(`/tasks/${taskId}/qa-submit`).set(auth(u)).send({ resolution: '<p>Done</p>', actualHours: 3, artifacts });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_qa_review_artifacts, task_dependency_tickets, audit_logs RESTART IDENTITY CASCADE`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    const row = (
      await ds.query(
        `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, 'designerD@test.local', 'x', 'Name designerD', 'designer') RETURNING id`,
        [f.tenants.t1],
      )
    )[0];
    await ds.query(`INSERT INTO user_projects ("usersId", "projectsId") VALUES ($1, $2)`, [row.id, f.projects.pA]);
    designer = { id: row.id, email: 'designerD@test.local', tenantId: f.tenants.t1, role: 'designer' };
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a Designer submits with Prototype, Design file and Design spec; they are stored and listed', async () => {
    const taskId = await newTask(designer);
    const artifacts = [
      { type: 'Prototype', url: 'https://www.figma.com/proto/abc' },
      { type: 'Design file', url: 'https://www.figma.com/file/abc' },
      { type: 'Design spec', url: 'https://example.com/spec' },
    ];
    await submit(designer, taskId, artifacts).expect(201);
    const rounds = (await http().get(`/tasks/${taskId}/qa-reviews`).set(auth(designer)).expect(200)).body;
    expect(rounds[0].artifacts.map((a: any) => a.type).sort()).toEqual(['Design file', 'Design spec', 'Prototype']);
  });

  it('unchanged rules: each type once per submission; developers keep their types; an unknown type is refused', async () => {
    const t1 = await newTask(designer);
    await submit(designer, t1, [
      { type: 'Prototype', url: 'https://example.com/a' },
      { type: 'Prototype', url: 'https://example.com/b' },
    ]).expect(400);
    await submit(designer, t1, [{ type: 'Figma board', url: 'https://example.com/a' }]).expect(400);
    const t2 = await newTask(f.users.devA);
    await submit(f.users.devA, t2, [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }]).expect(201);
  });
});
