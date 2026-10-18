import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { MemoryStorage } from './setup/memory-storage';

// Screenshots on a QA decision (2026-10-18): the QA who approved, rejected
// or escalated a round attaches screenshots to it afterwards; anyone who
// can view the task can see them. Plus: screenshots on defects raised
// from a rejection go through the existing defect-screenshot endpoint.
describe('QA decision screenshots (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let storage: MemoryStorage;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let moduleId: number; // an LMS module (fixtures' modules are on other projects)
  let qaTwo: FixtureUser;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest-of-png')]);
  const upload = (u: FixtureUser, url: string, files: Array<[string, Buffer]>) => {
    let req = http().post(url).set(auth(u));
    for (const [name, data] of files) req = req.attach('files', data, name);
    return req;
  };
  const artifacts = [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }];

  // A task submitted for QA by devA on the LMS project (qaB is on it).
  const submittedTask = async () => {
    seq += 1;
    const [row] = await ds.query(
      `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", title, description, status, "estimatedHours", "dueDate", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
       VALUES ($1, $2, 'LMS', $3, 'Registration', $4, 'UAT', $5, 'x', 'Development', 4, '2026-12-31', $6, $7, $8, $9) RETURNING id`,
      [f.tenants.t1, f.projects.pLms, moduleId, phaseId, `Decision screenshots ${seq}`, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
    );
    await post(f.users.devA, `/tasks/${row.id}/qa-submit`, { resolution: '<p>Done</p>', actualHours: 2, artifacts }).expect(201);
    return row.id as number;
  };
  const latestRoundId = async (taskId: number) =>
    (await ds.query(`SELECT id FROM task_qa_reviews WHERE "taskId" = $1 ORDER BY "roundNumber" DESC, id DESC LIMIT 1`, [taskId]))[0].id as number;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    storage = t.storage;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_dependency_tickets, task_blocking_defects, task_qa_reviews, task_qa_review_artifacts, task_qa_review_qa_artifacts, task_attachments, task_qa_review_attachments, task_defect_artifacts, user_notifications, audit_logs RESTART IDENTITY CASCADE`);
    await ds.query(`UPDATE projects SET "pmReviewEnabled" = false`);
    moduleId = (await ds.query(`INSERT INTO modules ("tenantId", "projectId", name, "isActive") VALUES ($1, $2, 'Registration', true) RETURNING id`, [f.tenants.t1, f.projects.pLms]))[0].id;
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'LMS', $3, 'Registration', 'UAT') RETURNING id`,
        [f.tenants.t1, f.projects.pLms, moduleId],
      )
    )[0].id;
    const [row] = await ds.query(`INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, 'qaTwo@test.local', 'x', 'QA Two', 'qa') RETURNING id`, [f.tenants.t1]);
    await ds.query(`INSERT INTO user_projects ("usersId", "projectsId") VALUES ($1, $2)`, [row.id, f.projects.pLms]);
    qaTwo = { id: row.id, email: 'qaTwo@test.local', tenantId: f.tenants.t1, role: 'qa' } as FixtureUser;
  });

  beforeEach(() => storage.reset());

  afterAll(async () => {
    await app.close();
  });

  it('the QA who approved attaches screenshots; the developer and PM can view them', async () => {
    const id = await submittedTask();
    await patch(f.users.qaB, `/tasks/${id}/qa-approve`, {}).expect(200);
    const round = await latestRoundId(id);
    const res = await upload(f.users.qaB, `/tasks/${id}/qa-reviews/${round}/attachments`, [['ok.png', PNG], ['ok2.png', PNG]]).expect(201);
    expect(res.body.map((a: any) => [a.taskQaReviewId, a.fileName])).toEqual([
      [round, 'ok.png'],
      [round, 'ok2.png'],
    ]);
    expect([...storage.objects.keys()].every((k) => k.includes(`/qa-review-${round}/`))).toBe(true);
    for (const viewer of [f.users.devA, f.users.pm, f.users.admin]) {
      const list = (await get(viewer, `/tasks/${id}/qa-review-attachments`).expect(200)).body;
      expect(list).toHaveLength(2);
    }
    const file = await get(f.users.devA, `/tasks/qa-review-attachments/${res.body[0].id}`).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it('works for reject and escalate rounds too', async () => {
    const rejected = await submittedTask();
    await patch(f.users.qaB, `/tasks/${rejected}/qa-reject`, { comment: '<p>Broken on save</p>' }).expect(200);
    await upload(f.users.qaB, `/tasks/${rejected}/qa-reviews/${await latestRoundId(rejected)}/attachments`, [['r.png', PNG]]).expect(201);

    const escalated = await submittedTask();
    await patch(f.users.qaB, `/tasks/${escalated}/qa-escalate`, { comment: '<p>Needs a PM decision</p>' }).expect(200);
    await upload(f.users.qaB, `/tasks/${escalated}/qa-reviews/${await latestRoundId(escalated)}/attachments`, [['e.png', PNG]]).expect(201);
  });

  it('only the QA who made the decision can attach - not another QA, the developer, PM or Admin', async () => {
    const id = await submittedTask();
    await patch(f.users.qaB, `/tasks/${id}/qa-approve`, {}).expect(200);
    const round = await latestRoundId(id);
    for (const u of [qaTwo, f.users.devA, f.users.pm, f.users.admin]) {
      await upload(u, `/tasks/${id}/qa-reviews/${round}/attachments`, [['x.png', PNG]]).expect(403);
    }
    expect(storage.objects.size).toBe(0);
  });

  it('not on a round that is still waiting for a decision', async () => {
    const id = await submittedTask();
    await upload(f.users.qaB, `/tasks/${id}/qa-reviews/${await latestRoundId(id)}/attachments`, [['x.png', PNG]]).expect(403);
  });

  it('a round must belong to the task in the URL', async () => {
    const a = await submittedTask();
    const b = await submittedTask();
    await patch(f.users.qaB, `/tasks/${a}/qa-approve`, {}).expect(200);
    await upload(f.users.qaB, `/tasks/${b}/qa-reviews/${await latestRoundId(a)}/attachments`, [['x.png', PNG]]).expect(404);
  });

  it('images only, at most 5 per decision; nothing is left in storage when refused', async () => {
    const id = await submittedTask();
    await patch(f.users.qaB, `/tasks/${id}/qa-approve`, {}).expect(200);
    const url = `/tasks/${id}/qa-reviews/${await latestRoundId(id)}/attachments`;
    await upload(f.users.qaB, url, [['ok.png', PNG], ['page.png', Buffer.from('<html><script>alert(1)</script></html>')]]).expect(400);
    expect(storage.objects.size).toBe(0);
    await upload(f.users.qaB, url, [1, 2, 3, 4].map((n) => [`s${n}.png`, PNG] as [string, Buffer])).expect(201);
    await upload(f.users.qaB, url, [['five.png', PNG], ['six.png', PNG]]).expect(400);
    await upload(f.users.qaB, url, [['five.png', PNG]]).expect(201);
  });

  it('people who cannot view the task cannot list or download them', async () => {
    const id = await submittedTask();
    await patch(f.users.qaB, `/tasks/${id}/qa-approve`, {}).expect(200);
    const res = await upload(f.users.qaB, `/tasks/${id}/qa-reviews/${await latestRoundId(id)}/attachments`, [['x.png', PNG]]).expect(201);
    for (const u of [f.users.devNone, f.users.pmT2, f.users.clientA]) {
      const list = await get(u, `/tasks/${id}/qa-review-attachments`);
      expect([403, 404]).toContain(list.status);
      const file = await get(u, `/tasks/qa-review-attachments/${res.body[0].id}`);
      expect([403, 404]).toContain(file.status);
    }
  });

  it('defects raised from a rejection get their screenshots through the defect endpoint (the rejecting QA is their raiser)', async () => {
    const id = await submittedTask();
    const res = await patch(f.users.qaB, `/tasks/${id}/qa-reject`, {
      comment: '<p>Two problems</p>',
      linkedDefects: [
        { title: 'Save button does nothing', description: '<p>Steps...</p>', assigneeUserId: f.users.devA.id },
        { title: 'Wrong total shown', description: '<p>Steps...</p>', assigneeUserId: f.users.devA.id },
      ],
    });
    expect(res.status).toBe(200);
    const [d1, d2] = res.body.linkedDefects.map((d: any) => d.id);
    await upload(f.users.qaB, `/tasks/${d1}/attachments`, [['save.png', PNG]]).expect(201);
    await upload(f.users.qaB, `/tasks/${d2}/attachments`, [['total.png', PNG]]).expect(201);
    await upload(qaTwo, `/tasks/${d1}/attachments`, [['x.png', PNG]]).expect(403);
    expect((await get(f.users.devA, `/tasks/${d1}/attachments`).expect(200)).body.map((a: any) => a.fileName)).toEqual(['save.png']);
  });

  it('the raiser can add a screenshot to an existing defect later', async () => {
    const id = await submittedTask();
    const res = await patch(f.users.qaB, `/tasks/${id}/qa-reject`, {
      comment: '<p>Problem</p>',
      linkedDefects: [{ title: 'Late screenshot', description: '<p>x</p>', assigneeUserId: f.users.devA.id }],
    }).expect(200);
    const defectId = res.body.linkedDefects[0].id;
    await upload(f.users.qaB, `/tasks/${defectId}/attachments`, [['later.png', PNG]]).expect(201);
    await upload(f.users.devA, `/tasks/${defectId}/attachments`, [['x.png', PNG]]).expect(403);
  });
});
