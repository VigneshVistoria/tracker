import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { TASK_FIELDS_AUDIT } from '../src/tasks/task-fields';

// Performance Tracking S4b (2026-10-28): task type, requirement ID, client
// impact, and the PM's decision on a developer's improvement. OFF = the
// fields aren't taken. ON = type required at creation (no default); before
// QA submission a Feature needs a requirement ID and a Feature or
// Improvement a client impact of 20+ characters; type changes PM only,
// texts PM or assignee; a PM accepts or declines a developer-created
// Improvement (decline keeps the type, reason required); bulk import takes
// the same optional columns under the same rules.
describe('Task type, requirement ID, client impact (Performance Tracking S4b, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let lmsModuleId: number;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const audits = (id: number, action: string) =>
    ds.query(`SELECT * FROM audit_logs WHERE "entityType" = 'ProjectTask' AND "entityId" = $1 AND action = $2 ORDER BY id`, [id, action]);
  const setTracking = (enabled: boolean) => patch(f.users.pm, `/performance-tracking/projects/${f.projects.pLms}`, { enabled }).expect(200);
  const IMPACT = 'Claims staff can save a claim without a date';
  const base = () => ({ projectId: f.projects.pLms, moduleId: lmsModuleId, phaseId, title: 'Claim date check', description: '<p>x</p>' });
  const create = (u: FixtureUser, extra: any = {}) => post(u, '/tasks', { ...base(), ...extra });
  const PR = { type: 'Pull Request Link', url: 'https://example.com/pr/1' };
  const submit = (id: number) =>
    post(f.users.devA, `/tasks/${id}/qa-submit`, { resolution: '<p>Done</p>', actualHours: 2, artifacts: [PR], dependencies: { met: true } });
  const ready = (id: number) => ds.query(`UPDATE project_tasks SET "estimatedHours" = 4, "dueDate" = '2026-12-31' WHERE id = $1`, [id]);
  const importCsv = (rows: string[]) =>
    post(f.users.pm, '/tasks/bulk-import', {
      format: 'csv',
      fileBase64: Buffer.from(['Project,Module,Phase,Title,Description,Priority,Assignee,Type,Requirement ID,Client impact', ...rows].join('\n')).toString('base64'),
    });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, audit_logs RESTART IDENTITY CASCADE`);
    await ds.query(`UPDATE projects SET "submissionChecklistEnabled" = false, "pmReviewEnabled" = false`);
    lmsModuleId = (await ds.query(`SELECT id FROM modules WHERE "projectId" = $1 AND name = 'LMS Module'`, [f.projects.pLms]))[0].id;
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'LMS', $3, 'LMS Module', 'UAT') RETURNING id`,
        [f.tenants.t1, f.projects.pLms, lmsModuleId],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('switch OFF - nothing changes', () => {
    beforeAll(() => setTracking(false));

    it('creates as before; the fields are refused; QA submission needs nothing new', async () => {
      const id = (await create(f.users.pm).expect(201)).body.id;
      expect(await taskRow(id)).toMatchObject({ taskType: null, requirementId: null, clientImpact: null });
      await create(f.users.pm, { taskType: 'feature' }).expect(400);
      await patch(f.users.pm, `/tasks/${id}/tracking-fields`, { taskType: 'feature' }).expect(400);
      expect((await get(f.users.pm, `/tasks/${id}/tracking-fields`).expect(200)).body).toMatchObject({ trackingOn: false, canEditType: false });
    });
  });

  describe('switch ON', () => {
    beforeAll(() => setTracking(true));

    it('type is required at creation (no default), by the PM or a developer for their own task', async () => {
      await create(f.users.pm).expect(400);
      await create(f.users.pm, { taskType: 'Epic' }).expect(400);
      await create(f.users.pm, { taskType: 'Feature', clientImpact: 'too short' }).expect(400);
      const id = (await create(f.users.pm, { taskType: 'Feature', requirementId: ' REQ-12 ', clientImpact: IMPACT }).expect(201)).body.id;
      expect(await taskRow(id)).toMatchObject({ taskType: 'feature', requirementId: 'REQ-12', clientImpact: IMPACT });
      const own = (await create(f.users.devA, { taskType: 'improvement' }).expect(201)).body.id;
      expect(await taskRow(own)).toMatchObject({ taskType: 'improvement', createdByUserId: f.users.devA.id });
    });

    it('before QA submission: Feature needs a requirement ID and client impact; Improvement client impact; Other nothing', async () => {
      const feature = (await create(f.users.pm, { taskType: 'feature', assigneeUserId: f.users.devA.id }).expect(201)).body.id;
      await ready(feature);
      const res = await submit(feature).expect(400);
      expect(res.body.message).toContain('Requirement ID');
      expect(res.body.message).toContain('client impact');
      // The assignee fills them in.
      await patch(f.users.devA, `/tasks/${feature}/tracking-fields`, { requirementId: 'REQ-7', clientImpact: IMPACT }).expect(200);
      await submit(feature).expect(201);

      const improvement = (await create(f.users.pm, { taskType: 'improvement', assigneeUserId: f.users.devA.id }).expect(201)).body.id;
      await ready(improvement);
      expect((await submit(improvement).expect(400)).body.message).toContain('client impact');

      const other = (await create(f.users.pm, { taskType: 'other', assigneeUserId: f.users.devA.id }).expect(201)).body.id;
      await ready(other);
      await submit(other).expect(201);
    });

    it('type: PM only after creation; texts: PM or the assignee; every change audited', async () => {
      const id = (await create(f.users.pm, { taskType: 'other', assigneeUserId: f.users.devA.id }).expect(201)).body.id;
      await patch(f.users.devA, `/tasks/${id}/tracking-fields`, { taskType: 'feature' }).expect(403);
      // Admin may change the type (2026-10-28) but not the texts.
      await patch(f.users.admin, `/tasks/${id}/tracking-fields`, { taskType: 'improvement' }).expect(200);
      await patch(f.users.admin, `/tasks/${id}/tracking-fields`, { requirementId: 'REQ-1' }).expect(403);
      await patch(f.users.devNone, `/tasks/${id}/tracking-fields`, { requirementId: 'REQ-1' }).expect(403);
      await patch(f.users.pm, `/tasks/${id}/tracking-fields`, { taskType: 'feature' }).expect(200);
      await patch(f.users.devA, `/tasks/${id}/tracking-fields`, { clientImpact: 'short' }).expect(400);
      await patch(f.users.devA, `/tasks/${id}/tracking-fields`, { requirementId: 'REQ-9' }).expect(200);
      expect(await taskRow(id)).toMatchObject({ taskType: 'feature', requirementId: 'REQ-9' });
      const logged = await audits(id, TASK_FIELDS_AUDIT.FIELDS_UPDATED);
      expect(logged.map((a: any) => JSON.parse(a.details))).toEqual([
        { before: { taskType: 'other' }, after: { taskType: 'improvement' } },
        { before: { taskType: 'improvement' }, after: { taskType: 'feature' } },
        { before: { requirementId: null }, after: { requirementId: 'REQ-9' } },
      ]);
    });

    it('O5: a PM accepts or declines a developer-created Improvement; declining keeps the type and needs a reason', async () => {
      const own = (await create(f.users.devA, { taskType: 'improvement' }).expect(201)).body.id;
      expect((await get(f.users.pm, `/tasks/${own}/tracking-fields`).expect(200)).body).toMatchObject({ selfInitiatedImprovement: true, canDecide: true });
      await patch(f.users.devA, `/tasks/${own}/improvement-decision`, { decision: 'accepted' }).expect(403);
      await patch(f.users.exec, `/tasks/${own}/improvement-decision`, { decision: 'accepted' }).expect(403);
      await patch(f.users.pm, `/tasks/${own}/improvement-decision`, { decision: 'declined' }).expect(400);
      await patch(f.users.pm, `/tasks/${own}/improvement-decision`, { decision: 'declined', reason: 'Already planned for Q1' }).expect(200);
      expect(await taskRow(own)).toMatchObject({ taskType: 'improvement', improvementDecision: 'declined', improvementDeclineReason: 'Already planned for Q1' });
      // Changing the decision is allowed and logged.
      await patch(f.users.pm, `/tasks/${own}/improvement-decision`, { decision: 'accepted' }).expect(200);
      expect(await taskRow(own)).toMatchObject({ improvementDecision: 'accepted', improvementDecidedByUserId: f.users.pm.id, improvementDeclineReason: null });
      expect(await audits(own, TASK_FIELDS_AUDIT.IMPROVEMENT_DECIDED)).toHaveLength(2);

      // Admin can decide too (2026-10-28).
      await patch(f.users.admin, `/tasks/${own}/improvement-decision`, { decision: 'declined', reason: 'Duplicate of the Q1 plan' }).expect(200);
      expect(await taskRow(own)).toMatchObject({ improvementDecision: 'declined', improvementDecidedByUserId: f.users.admin.id });

      // A PM-created Improvement is planned work - nothing to decide.
      const planned = (await create(f.users.pm, { taskType: 'improvement' }).expect(201)).body.id;
      await patch(f.users.pm, `/tasks/${planned}/improvement-decision`, { decision: 'accepted' }).expect(400);
    });

    it('before Peer Review submission a Feature needs the same requirement ID and client impact', async () => {
      const peer = (s: number) =>
        post(f.users.devA, `/tasks/${s}/peer-review-submit`, { resolution: 'Done', actualHours: 1, artifacts: [PR], reviewerUserId: f.users.devNone.id });
      const feature = (await create(f.users.pm, { taskType: 'feature', assigneeUserId: f.users.devA.id, peerReviewEnabled: true }).expect(201)).body.id;
      await ready(feature);
      const res = await peer(feature).expect(400);
      expect(res.body.message).toContain('Peer Review');
      expect(res.body.message).toContain('Requirement ID');
      await patch(f.users.pm, `/tasks/${feature}/tracking-fields`, { requirementId: 'REQ-5', clientImpact: IMPACT }).expect(200);
      await peer(feature).expect(201);
      // Feature only (the user's decision) - an Improvement isn't checked here.
      const improvement = (await create(f.users.pm, { taskType: 'improvement', assigneeUserId: f.users.devA.id, peerReviewEnabled: true }).expect(201)).body.id;
      await ready(improvement);
      await peer(improvement).expect(201);
    });

    it('Team Tasks filters by type', async () => {
      const body = (await get(f.users.pm, '/tasks/team?all=true&taskType=improvement').expect(200)).body;
      expect(body.tasks.length).toBeGreaterThan(0);
      expect(body.tasks.every((t: any) => t.taskType === 'improvement')).toBe(true);
      await get(f.users.pm, '/tasks/team?taskType=epic').expect(400);
    });

    it('bulk import: optional columns, the same rules', async () => {
      const bad = await importCsv(['LMS,LMS Module,UAT,No type,,,,,,', 'LMS,LMS Module,UAT,Bad type,,,,Epic,,', 'LMS,LMS Module,UAT,Short impact,,,,Feature,REQ-1,short']).expect(201);
      expect(bad.body.success).toBe(false);
      expect(bad.body.errors.map((e: any) => e.row)).toEqual([2, 3, 4]);
      const ok = await importCsv([`LMS,LMS Module,UAT,Imported feature,,,,feature,REQ-3,${IMPACT}`, 'LMS,LMS Module,UAT,Imported other,,,,Other,,']).expect(201);
      expect(ok.body.success).toBe(true);
      const rows = await ds.query(`SELECT "taskType", "requirementId", "clientImpact" FROM project_tasks WHERE id = ANY($1) ORDER BY id`, [ok.body.created]);
      expect(rows).toEqual([
        { taskType: 'feature', requirementId: 'REQ-3', clientImpact: IMPACT },
        { taskType: 'other', requirementId: null, clientImpact: null },
      ]);
    });

    it('a defect has none of these', async () => {
      const id = await (async () => {
        const [row] = await ds.query(
          `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "isDefect", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
           VALUES ($1, $2, 'LMS', $3, 'LMS Module', $4, 'UAT', 'A defect', 'x', 'Development', true, $5, $6, $7, $8) RETURNING id`,
          [f.tenants.t1, f.projects.pLms, lmsModuleId, phaseId, f.users.devA.id, f.users.devA.email, f.users.qaB.id, f.users.qaB.email],
        );
        return row.id as number;
      })();
      await patch(f.users.pm, `/tasks/${id}/tracking-fields`, { taskType: 'feature' }).expect(400);
      expect((await get(f.users.pm, `/tasks/${id}/tracking-fields`).expect(200)).body).toMatchObject({ trackingOn: false, missingBeforeSubmission: [] });
    });
  });
});
