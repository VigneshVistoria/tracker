import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { MemoryStorage } from './setup/memory-storage';
import { isPastEffectiveDue } from '../src/tasks/pm-review';

// Return to QA (2026-10-18): a Program Manager sends a developer-side
// ticket back to QA; that QA fixes a defect's evidence and sends it back.
describe('Return to QA (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let storage: MemoryStorage;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let qaOther: FixtureUser; // a QA on no shared project
  let qaTwo: FixtureUser; // a second QA on the LMS project
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const del = (u: FixtureUser, url: string) => http().delete(url).set(auth(u));
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const audits = (id: number, action: string) =>
    ds.query(`SELECT * FROM audit_logs WHERE "entityType" = 'ProjectTask' AND "entityId" = $1 AND action = $2 ORDER BY id`, [id, action]);
  // Notifications are written just after the response - wait (briefly)
  // for one of this type and link to show up.
  const notified = async (userId: number, type: string, taskId: number) => {
    for (let i = 0; i < 40; i++) {
      const rows = await ds.query(`SELECT 1 FROM user_notifications WHERE "userId" = $1 AND type = $2 AND link = $3`, [userId, type, `/tasks/${taskId}`]);
      if (rows.length) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const returnIt = (id: number, body: any = { reason: 'Wrong evidence attached by QA' }, u = f.users.pm) => patch(u, `/tasks/${id}/return-to-qa`, body);
  const sendBack = (id: number, u: FixtureUser, body: any = {}) => patch(u, `/tasks/${id}/return-to-qa/send-back`, body);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest-of-png')]);

  const newTask = async (values: Record<string, any> = {}) => {
    seq += 1;
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pLms,
      projectName: 'LMS',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'UAT',
      title: `Return to QA ticket ${seq}`,
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
    return res[0].id as number;
  };
  const newDefect = (values: Record<string, any> = {}) =>
    newTask({ isDefect: true, createdByUserId: f.users.qaB.id, createdByEmail: f.users.qaB.email, ...values });
  const addRound = (taskId: number, values: Record<string, any>) =>
    ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", resolution, "submittedByUserId", "submittedByEmail", "submittedAt", status, "reviewType", "reviewedByUserId", "reviewedByEmail", "reviewedAt")
       VALUES ($1, $2, $3, '<p>done</p>', $4, $5, now(), $6, $7, $8, $9, now())`,
      [f.tenants.t1, taskId, values.roundNumber ?? 1, f.users.devA.id, f.users.devA.email, values.status, values.reviewType ?? 'qa', values.reviewedBy?.id ?? null, values.reviewedBy?.email ?? null],
    );
  const addUser = async (key: string, role: string, projects: number[]) => {
    const email = `${key}@test.local`;
    const [row] = await ds.query(
      `INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
      [f.tenants.t1, email, `Name ${key}`, role],
    );
    for (const p of projects) await ds.query(`INSERT INTO user_projects ("usersId", "projectsId") VALUES ($1, $2)`, [row.id, p]);
    return { id: row.id, email, tenantId: f.tenants.t1, role } as FixtureUser;
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    storage = t.storage;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_dependency_tickets, task_blocking_defects, task_qa_reviews, task_defect_artifacts, task_attachments, user_notifications, audit_logs RESTART IDENTITY CASCADE`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'LMS', $3, 'Medical Claim', 'UAT') RETURNING id`,
        [f.tenants.t1, f.projects.pLms, f.modules.mA],
      )
    )[0].id;
    qaOther = await addUser('qaOther', 'qa', [f.projects.pC]);
    qaTwo = await addUser('qaTwo', 'qa', [f.projects.pLms]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PM sends a ticket back to QA', () => {
    it('a defect goes to its raiser, with audit and notifications', async () => {
      const id = await newDefect();
      const res = await returnIt(id).expect(200);
      expect(res.body.task.status).toBe('Returned to QA');
      const [a] = await audits(id, 'task_returned_to_qa');
      const d = JSON.parse(a.details);
      expect(a.userId).toBe(f.users.pm.id);
      expect(d).toMatchObject({ qaUserId: f.users.qaB.id, statusFrom: 'Development', reason: 'Wrong evidence attached by QA' });
      expect(await notified(f.users.qaB.id, 'task.returnedToQa', id)).toBe(true);
      expect(await notified(f.users.devA.id, 'task.returnedToQa', id)).toBe(true);
    });

    it('only a Program Manager can do it', async () => {
      const id = await newDefect();
      for (const u of [f.users.admin, f.users.devA, f.users.qaB, f.users.exec]) {
        await returnIt(id, undefined, u).expect(403);
      }
      expect((await taskRow(id)).status).toBe('Development');
    });

    it('works from Development, Failed and PM Feedback only', async () => {
      for (const status of ['Failed', 'PM Feedback']) {
        const id = await newDefect({ status });
        await returnIt(id).expect(200);
      }
      for (const status of ['Feedback', 'Re-Feedback', 'Pass', 'Hold', 'Escalated', 'Pending PM Review']) {
        const id = await newDefect({ status });
        await returnIt(id).expect(400);
        expect((await taskRow(id)).status).toBe(status);
      }
      const junk = await newDefect({ status: 'Junk' });
      await returnIt(junk).expect(400);
    });

    it('a reason of at least 10 characters is required', async () => {
      const id = await newDefect();
      await returnIt(id, { reason: 'too short' }).expect(400);
      await returnIt(id, {}).expect(400);
    });

    it('a task goes to the QA who last decided on it; with no QA history the PM must pick', async () => {
      const failed = await newTask({ status: 'Failed' });
      await addRound(failed, { status: 'rejected', reviewedBy: qaTwo });
      await returnIt(failed).expect(200);
      expect(JSON.parse((await audits(failed, 'task_returned_to_qa'))[0].details).qaUserId).toBe(qaTwo.id);

      const fresh = await newTask();
      const res = await returnIt(fresh).expect(400);
      expect(res.body.message).toMatch(/pick the QA/);
      await returnIt(fresh, { reason: 'Needs QA to confirm the steps', qaUserId: f.users.qaB.id }).expect(200);
      expect(JSON.parse((await audits(fresh, 'task_returned_to_qa'))[0].details).qaUserId).toBe(f.users.qaB.id);
    });

    it('the PM may pick a different QA, but only a QA on the ticket\'s project', async () => {
      const id = await newDefect();
      await returnIt(id, { reason: 'Please re-check this one', qaUserId: f.users.devA.id }).expect(400);
      await returnIt(id, { reason: 'Please re-check this one', qaUserId: qaOther.id }).expect(400);
      await returnIt(id, { reason: 'Please re-check this one', qaUserId: qaTwo.id }).expect(200);
    });

    it('two PM clicks at once: exactly one succeeds', async () => {
      const id = await newDefect();
      const [a, b] = await Promise.all([returnIt(id), returnIt(id)]);
      expect([a.status, b.status].sort()).toEqual([200, 400]);
      expect(await audits(id, 'task_returned_to_qa')).toHaveLength(1);
    });
  });

  describe('while it is with QA', () => {
    it('the developer cannot submit it', async () => {
      const id = await newTask();
      await returnIt(id, { reason: 'QA needs to look again', qaUserId: f.users.qaB.id }).expect(200);
      const res = await post(f.users.devA, `/tasks/${id}/qa-submit`, {
        resolution: '<p>Done</p>',
        actualHours: 3,
        artifacts: [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }],
      }).expect(400);
      expect(res.body.message).toMatch(/sent back to QA/);
    });

    it('it is not overdue, and it stays in the raiser\'s open defects', async () => {
      expect(isPastEffectiveDue({ status: 'Returned to QA', dueDate: '2020-01-01', pmWaitWorkingDays: 0 }, '2026-10-18')).toBe(false);
      expect(isPastEffectiveDue({ status: 'Development', dueDate: '2020-01-01', pmWaitWorkingDays: 0 }, '2026-10-18')).toBe(true);
      const id = await newDefect();
      await returnIt(id).expect(200);
      const queue = (await get(f.users.qaB, '/tasks/defect-queue').expect(200)).body;
      const rows = Array.isArray(queue) ? queue : queue.tasks || queue.items || [];
      expect(rows.some((t: any) => t.id === id)).toBe(true);
    });

    it('the QA sees it in their Returned to QA list, others do not', async () => {
      const id = await newDefect();
      await returnIt(id).expect(200);
      expect((await get(f.users.qaB, '/tasks/returned-to-qa').expect(200)).body.some((t: any) => t.id === id && t.reason === 'Wrong evidence attached by QA')).toBe(true);
      expect((await get(qaTwo, '/tasks/returned-to-qa').expect(200)).body.some((t: any) => t.id === id)).toBe(false);
    });

    it('the state endpoint tells each role what it may do', async () => {
      const id = await newDefect();
      expect((await get(f.users.pm, `/tasks/${id}/return-to-qa`).expect(200)).body).toMatchObject({ canReturn: true, canSendBack: false, defaultQa: { id: f.users.qaB.id } });
      await returnIt(id).expect(200);
      expect((await get(f.users.qaB, `/tasks/${id}/return-to-qa`).expect(200)).body).toMatchObject({ canSendBack: true, canEditEvidence: true, current: { qaUserId: f.users.qaB.id } });
      expect((await get(f.users.devA, `/tasks/${id}/return-to-qa`).expect(200)).body).toMatchObject({ canReturn: false, canSendBack: false, canEditEvidence: false });
      expect((await get(f.users.pm, `/tasks/${id}/return-to-qa`).expect(200)).body).toMatchObject({ canReturn: false, canSendBack: true, canEditEvidence: false });
    });
  });

  describe('evidence and screenshots', () => {
    const evidence = (id: number) => ds.query(`SELECT * FROM task_defect_artifacts WHERE "taskId" = $1 ORDER BY id`, [id]);

    it('the QA it was returned to can replace a wrong evidence link; the removed link stays in the audit', async () => {
      const id = await newDefect();
      const [wrong] = await ds.query(`INSERT INTO task_defect_artifacts ("taskId", type, url) VALUES ($1, 'Screenshot', 'https://wrong.example/video') RETURNING id`, [id]);
      // Not while it is with the developer.
      await del(f.users.qaB, `/tasks/${id}/defect-artifacts/${wrong.id}`).expect(400);
      await returnIt(id).expect(200);
      // Duplicate type refused until the wrong one is removed.
      await post(f.users.qaB, `/tasks/${id}/defect-artifacts`, { type: 'Screenshot', url: 'https://right.example/shot' }).expect(400);
      await del(f.users.qaB, `/tasks/${id}/defect-artifacts/${wrong.id}`).expect(200);
      await post(f.users.qaB, `/tasks/${id}/defect-artifacts`, { type: 'Screenshot', url: 'https://right.example/shot' }).expect(201);
      const rows = await evidence(id);
      expect(rows.map((r: any) => r.url)).toEqual(['https://right.example/shot']);
      const [removed] = await audits(id, 'task_defect_evidence_removed');
      expect(JSON.parse(removed.details).url).toBe('https://wrong.example/video');
      expect(await audits(id, 'task_defect_evidence_added')).toHaveLength(1);
    });

    it('nobody else can change evidence, and bad links are refused', async () => {
      const id = await newDefect();
      const [a] = await ds.query(`INSERT INTO task_defect_artifacts ("taskId", type, url) VALUES ($1, 'Bug Report', 'https://x.example/bug') RETURNING id`, [id]);
      await returnIt(id, { reason: 'Second QA please check', qaUserId: qaTwo.id }).expect(200);
      for (const u of [f.users.qaB, f.users.pm, f.users.devA, f.users.admin]) {
        await del(u, `/tasks/${id}/defect-artifacts/${a.id}`).expect((r) => expect([403, 400]).toContain(r.status));
      }
      await post(qaTwo, `/tasks/${id}/defect-artifacts`, { type: 'Log File', url: 'not a url' }).expect(400);
      await post(qaTwo, `/tasks/${id}/defect-artifacts`, { type: 'Nonsense', url: 'https://x.example/a' }).expect(400);
      expect(await evidence(id)).toHaveLength(1);
    });

    it('the QA it was returned to can remove a screenshot (file deleted from storage too)', async () => {
      const id = await newDefect();
      const up = await http().post(`/tasks/${id}/attachments`).set(auth(f.users.qaB)).attach('files', PNG, 'wrong.png').expect(201);
      const attachmentId = up.body[0].id;
      expect(storage.objects.size).toBeGreaterThan(0);
      const before = storage.objects.size;
      await del(f.users.qaB, `/tasks/${id}/attachments/${attachmentId}`).expect(400); // not returned yet
      await returnIt(id).expect(200);
      await del(f.users.devA, `/tasks/${id}/attachments/${attachmentId}`).expect(403);
      const res = await del(f.users.qaB, `/tasks/${id}/attachments/${attachmentId}`).expect(200);
      expect(res.body).toEqual([]);
      expect(storage.objects.size).toBe(before - 1);
      expect(await audits(id, 'task_defect_screenshot_removed')).toHaveLength(1);
    });

    it('a different QA it was returned to can upload a screenshot to it', async () => {
      const id = await newDefect();
      await returnIt(id, { reason: 'Second QA please check', qaUserId: qaTwo.id }).expect(200);
      await http().post(`/tasks/${id}/attachments`).set(auth(qaTwo)).attach('files', PNG, 'right.png').expect(201);
    });
  });

  describe('QA sends it back to the developer', () => {
    it('goes to Development, QA wait days are added to the allowance, developer and PM are told', async () => {
      const id = await newDefect();
      await returnIt(id).expect(200);
      // Returned on Monday 2026-10-12, sent back now (>= 4 working days later).
      await ds.query(`UPDATE audit_logs SET "createdAt" = '2026-10-12 09:00' WHERE action = 'task_returned_to_qa' AND "entityId" = $1`, [id]);
      await ds.query(`UPDATE project_tasks SET "pmWaitWorkingDays" = 2 WHERE id = $1`, [id]);
      await sendBack(id, qaTwo).expect(403);
      await sendBack(id, f.users.devA).expect(403);
      const res = await sendBack(id, f.users.qaB, { note: 'Evidence fixed, link replaced' }).expect(200);
      expect(res.body.task.status).toBe('Development');
      const row = await taskRow(id);
      const [a] = await audits(id, 'task_return_to_qa_sent_back');
      const waited = JSON.parse(a.details).waitedWorkingDays;
      expect(waited).toBeGreaterThanOrEqual(4);
      expect(row.pmWaitWorkingDays).toBe(2 + waited);
      expect(await notified(f.users.devA.id, 'task.returnToQaSentBack', id)).toBe(true);
      expect(await notified(f.users.pm.id, 'task.returnToQaSentBack', id)).toBe(true);
      // Done: a second send-back is refused, and the developer can submit again.
      await sendBack(id, f.users.qaB).expect(400);
    });

    it('a PM can send it back too (undo a mistaken return)', async () => {
      const id = await newDefect();
      await returnIt(id).expect(200);
      await sendBack(id, f.users.pm).expect(200);
      expect((await taskRow(id)).status).toBe('Development');
    });

    it('two send-backs at once: exactly one succeeds', async () => {
      const id = await newDefect();
      await returnIt(id).expect(200);
      const [a, b] = await Promise.all([sendBack(id, f.users.qaB), sendBack(id, f.users.pm)]);
      expect([a.status, b.status].sort()).toEqual([200, 400]);
      expect(await audits(id, 'task_return_to_qa_sent_back')).toHaveLength(1);
    });
  });
});
