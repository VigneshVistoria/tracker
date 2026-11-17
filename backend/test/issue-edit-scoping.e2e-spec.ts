import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// 2026-11-15 (the user) - record-level edit scoping:
//  A  PATCH /issues/:id - title, description, assignee, project, module, phase,
//     showstopper may be CHANGED only by Admin, the assignee, the reporter, or
//     a PM on the issue's project (and the target project when moving it).
//  G1 POST /issues/:id/dependencies - the same people.
//  G4 PATCH /tasks/:id/qa-review-due-date - a QA only on tasks they can open.
//  G7 PATCH /dependencies/:id - owner moves status only; details and owner
//     stay with the creator/PM/Admin; a new owner must be in the tenant.
describe('Issue edit scoping + G1/G4/G7 (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let pmA: FixtureUser; // PM on Project A only
  let pmC: FixtureUser; // PM on Project C only
  let issueId: number;
  let phaseId: number;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const patch = (u: FixtureUser, url: string, body: any) => http().patch(url).set(auth(u)).send(body);
  const post = (u: FixtureUser, url: string, body: any) => http().post(url).set(auth(u)).send(body);
  const issue = async () => (await ds.query(`SELECT * FROM issues WHERE id = $1`, [issueId]))[0];

  const addUser = async (key: string, role: string, projects: number[]): Promise<FixtureUser> => {
    const email = `${key}@test.local`;
    const [row] = await ds.query(
      `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
      [f.tenants.t1, email, `Name ${key}`, role],
    );
    for (const p of projects) await ds.query(`INSERT INTO "user_projects" ("usersId", "projectsId") VALUES ($1, $2)`, [row.id, p]);
    return { id: row.id, email, tenantId: f.tenants.t1, role };
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE issues, dependencies, project_tasks, task_qa_reviews, audit_logs RESTART IDENTITY CASCADE`);
    pmA = await addUser('pmA', 'program_manager', [f.projects.pA]);
    pmC = await addUser('pmC', 'program_manager', [f.projects.pC]);
    // Admin files it on Project A for devA; qaB is recorded as the reporter.
    const res = await post(f.users.admin, '/issues', { title: 'Refund total wrong', description: 'Totals off by one', projectId: f.projects.pA, assigneeUserId: f.users.devA.id }).expect(201);
    issueId = res.body.id;
    await ds.query(`UPDATE issues SET "createdByUserId" = $1, "createdByEmail" = $2 WHERE id = $3`, [f.users.qaB.id, f.users.qaB.email, issueId]);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('A: PATCH /issues/:id', () => {
    it('refuses someone who is not the assignee, reporter, a PM on the project or Admin - for every content field', async () => {
      const cases: any[] = [
        { title: 'Hijacked' },
        { description: 'Rewritten' },
        { assigneeUserId: f.users.devNone.id },
        { projectId: f.projects.pLms },
        { moduleId: f.modules.mA },
        { showstopper: true },
      ];
      for (const body of cases) {
        for (const u of [f.users.devNone, pmC]) await patch(u, `/issues/${issueId}`, body).expect(403);
      }
      expect(await issue()).toMatchObject({ title: 'Refund total wrong', description: 'Totals off by one', assigneeUserId: f.users.devA.id, projectId: f.projects.pA, showstopper: false });
    });

    it('re-sending unchanged values (as the issue page does) is not a change', async () => {
      const page = { title: 'Refund total wrong', description: 'Totals off by one', assigneeUserId: f.users.devA.id, projectId: f.projects.pA, moduleId: null, phaseId: null, showstopper: false };
      await patch(f.users.devNone, `/issues/${issueId}`, page).expect(200);
    });

    it('allows the assignee, the reporter, a PM on the project and Admin', async () => {
      await patch(f.users.devA, `/issues/${issueId}`, { title: 'Refund total wrong (assignee)' }).expect(200);
      await patch(f.users.qaB, `/issues/${issueId}`, { description: 'Reporter added steps' }).expect(200);
      await patch(pmA, `/issues/${issueId}`, { showstopper: true }).expect(200);
      await patch(f.users.admin, `/issues/${issueId}`, { title: 'Refund total wrong' }).expect(200);
      expect(await issue()).toMatchObject({ title: 'Refund total wrong', description: 'Reporter added steps', showstopper: true });
    });

    it('a PM moving the issue must be on the target project too', async () => {
      await patch(pmA, `/issues/${issueId}`, { projectId: f.projects.pB }).expect(403);
      await patch(f.users.pm, `/issues/${issueId}`, { projectId: f.projects.pB }).expect(200);
      await patch(f.users.pm, `/issues/${issueId}`, { projectId: f.projects.pA }).expect(200);
    });

    it('Executive stays read-only', async () => {
      await patch(f.users.exec, `/issues/${issueId}`, { title: 'Exec edit' }).expect(403);
    });
  });

  describe('G1: POST /issues/:id/dependencies', () => {
    const child = () => ({ title: 'Need the refunds API key', assigneeUserId: f.users.devNone.id });
    it('refuses people who cannot change the parent issue', async () => {
      await post(f.users.devNone, `/issues/${issueId}/dependencies`, child()).expect(403);
      await post(pmC, `/issues/${issueId}/dependencies`, child()).expect(403);
      expect((await ds.query(`SELECT count(*)::int AS n FROM issues WHERE "parentIssueId" = $1`, [issueId]))[0].n).toBe(0);
    });
    it('allows the assignee, the reporter, a PM on the project and Admin', async () => {
      for (const u of [f.users.devA, f.users.qaB, pmA, f.users.admin]) await post(u, `/issues/${issueId}/dependencies`, child()).expect(201);
    });
  });

  describe('G4: PATCH /tasks/:id/qa-review-due-date', () => {
    const task = async (projectId: number, projectName: string, moduleId: number) => {
      const row: Record<string, any> = {
        tenantId: f.tenants.t1, projectId, projectName, moduleId, moduleName: 'M', phaseId, phaseName: 'Build',
        title: 'Task', description: 'x', status: 'Development', assigneeUserId: f.users.devA.id, assigneeEmail: f.users.devA.email,
        createdByUserId: f.users.pm.id, createdByEmail: f.users.pm.email,
      };
      const cols = Object.keys(row);
      const [r] = await ds.query(`INSERT INTO project_tasks (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(row));
      return r.id as number;
    };
    beforeAll(async () => {
      [{ id: phaseId }] = await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      );
    });

    it('a QA can change it only on tasks they can open; PM unchanged', async () => {
      const onA = await task(f.projects.pA, 'Project A', f.modules.mA); // qaB is not on Project A
      const onB = await task(f.projects.pB, 'Project B', f.modules.mB); // qaB is on Project B
      await patch(f.users.qaB, `/tasks/${onA}/qa-review-due-date`, { qaReviewDueDate: '2026-12-01' }).expect(403);
      await patch(f.users.qaB, `/tasks/${onB}/qa-review-due-date`, { qaReviewDueDate: '2026-12-01' }).expect(200);
      await patch(f.users.pm, `/tasks/${onA}/qa-review-due-date`, { qaReviewDueDate: '2026-12-02' }).expect(200);
      const [a] = await ds.query(`SELECT "qaReviewDueDate"::text AS d FROM project_tasks WHERE id = $1`, [onA]);
      expect(a.d).toBe('2026-12-02');
    });
  });

  describe('G7: PATCH /dependencies/:id', () => {
    let depId: number;
    beforeAll(async () => {
      const res = await post(f.users.devA, '/dependencies', {
        title: 'Refund API keys', description: 'Need prod keys', blockingReason: 'Cannot test refunds', requestedTeam: 'Platform',
        ownerUserId: f.users.devNone.id, ownerEmail: f.users.devNone.email, priority: 'High', requiredByDate: '2026-12-01',
        impactedIssueId: issueId, businessJustification: 'Go-live', impactLevel: 'High',
      }).expect(201);
      depId = res.body.id;
    });

    it('the owner can move the status but not edit details or hand it on', async () => {
      await patch(f.users.devNone, `/dependencies/${depId}`, { title: 'Owner rewrote it' }).expect(403);
      await patch(f.users.devNone, `/dependencies/${depId}`, { ownerUserId: f.users.qaB.id, ownerEmail: f.users.qaB.email }).expect(403);
      await patch(f.users.devNone, `/dependencies/${depId}/status`, { status: 'In Progress' }).expect(200);
    });

    it('the creator, PM and Admin can edit details; a new owner must be in the tenant', async () => {
      await patch(f.users.devA, `/dependencies/${depId}`, { title: 'Refund API keys (prod)' }).expect(200);
      await patch(f.users.pm, `/dependencies/${depId}`, { ownerUserId: f.users.pmT2.id, ownerEmail: f.users.pmT2.email }).expect(400);
      await patch(f.users.pm, `/dependencies/${depId}`, { ownerUserId: f.users.qaB.id, ownerEmail: f.users.qaB.email }).expect(200);
      await patch(f.users.admin, `/dependencies/${depId}`, { description: 'Need prod and UAT keys' }).expect(200);
      const [d] = await ds.query(`SELECT title, "ownerUserId", description, status FROM dependencies WHERE id = $1`, [depId]);
      expect(d).toMatchObject({ title: 'Refund API keys (prod)', ownerUserId: f.users.qaB.id, description: 'Need prod and UAT keys', status: 'In Progress' });
    });
  });
});
