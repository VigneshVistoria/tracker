import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// GET /tasks/mine/assignee-activity (developer home "My work",
// 2026-11-17): read only, my own 'Development' tasks only.
describe('GET /tasks/mine/assignee-activity (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;

  const get = (u: FixtureUser, url: string) => request(app.getHttpServer()).get(url).set({ Authorization: `Bearer ${tokenFor(u)}` });
  const newTask = async (title: string, status: string, assignee: FixtureUser) =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "createdAt")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', $5, 'x', $6, $7, $8, $9, $10, '2026-11-01T09:00:00Z') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, title, status, assignee.id, assignee.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;
  const audit = (taskId: number, action: string, user: FixtureUser, at: string, details: any = null) =>
    ds.query(
      `INSERT INTO audit_logs ("tenantId", "userId", "userEmail", "userRole", action, "entityType", "entityId", details, "createdAt") VALUES ($1, $2, $3, $4, $5, 'ProjectTask', $6, $7, $8)`,
      [f.tenants.t1, user.id, user.email, 'x', action, taskId, details ? JSON.stringify(details) : null, at],
    );

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_progress_notes, task_qa_reviews, audit_logs RESTART IDENTITY CASCADE`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('Not started vs last activity + last submitted date, own open tasks only', async () => {
    const fresh = await newTask('Fresh', 'Development', f.users.devA);
    const busy = await newTask('Busy', 'Development', f.users.devA);
    const submitted = await newTask('Submitted', 'Feedback', f.users.devA);
    await newTask('Closed', 'Closed', f.users.devA);
    await newTask('Someone else', 'Development', f.users.devNone);
    await audit(fresh, 'task_assigned', f.users.pm, '2026-11-03T00:00:00Z', { assigneeUserId: f.users.devA.id });
    await audit(busy, 'task_assigned', f.users.pm, '2026-11-03T00:00:00Z', { assigneeUserId: f.users.devA.id });
    await ds.query(
      `INSERT INTO task_progress_notes ("tenantId", "taskId", "projectId", "authorUserId", body, "taskStatus", "createdAt") VALUES ($1, $2, $3, $4, 'Started on the refund call', 'Development', '2026-11-10T08:00:00Z')`,
      [f.tenants.t1, busy, f.projects.pA, f.users.devA.id],
    );

    await ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", resolution, "submittedByUserId", "submittedByEmail", status, "reviewType", "submittedAt") VALUES ($1, $2, 1, 'done', $3, $4, 'pending', 'qa', '2026-11-12T10:00:00Z')`,
      [f.tenants.t1, submitted, f.users.devA.id, f.users.devA.email],
    );

    const body = (await get(f.users.devA, '/tasks/mine/assignee-activity').expect(200)).body;
    const byId = new Map(body.map((r: any) => [r.taskId, r]));
    expect([...byId.keys()].sort()).toEqual([fresh, busy, submitted].sort());
    expect(byId.get(fresh)).toEqual({ taskId: fresh, assignedAt: '2026-11-03T00:00:00.000Z', lastActivityAt: null, lastSubmittedAt: null });
    expect(byId.get(busy)).toEqual({ taskId: busy, assignedAt: '2026-11-03T00:00:00.000Z', lastActivityAt: '2026-11-10T08:00:00.000Z', lastSubmittedAt: null });
    expect((byId.get(submitted) as any).lastSubmittedAt).toBe('2026-11-12T10:00:00.000Z');

    // Someone with no Development tasks gets an empty list, never others' tasks.
    expect((await get(f.users.qaB, '/tasks/mine/assignee-activity').expect(200)).body).toEqual([]);
  });
});
