import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { effectiveDueDate, isPastEffectiveDue } from '../src/tasks/pm-review';
import { businessDaysBetween } from '../src/common/business-days';

// PM review gate before QA (2026-10-13): with the project switch on, a
// developer's task submission waits in "Pending PM Review" (not visible to
// QA) until a PM/Admin sends it to QA or back as "PM Feedback". PM rounds
// never count as QA rounds, and PM wait time never counts against the
// developer.
describe('PM review gate (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const rounds = (id: number) => ds.query(`SELECT * FROM task_qa_reviews WHERE "taskId" = $1 ORDER BY "roundNumber"`, [id]);

  const artifacts = [{ type: 'Pull Request Link', url: 'https://example.com/pr/9' }];
  const submit = (id: number, u = f.users.devA) => post(u, `/tasks/${id}/qa-submit`, { resolution: '<p>Done</p>', actualHours: 3, artifacts });
  const sendToQa = (u: FixtureUser, id: number, comment?: string) => patch(u, `/pm-review/tasks/${id}/send-to-qa`, comment ? { comment } : {});
  const sendBack = (u: FixtureUser, id: number, comment = '<p>Please add the API docs</p>') => patch(u, `/pm-review/tasks/${id}/send-back`, { comment });
  const setSwitch = (u: FixtureUser, projectId: number, enabled: boolean) => patch(u, `/pm-review/projects/${projectId}`, { enabled });
  const qaQueueIds = async () => ((await get(f.users.pm, '/tasks/qa-queue?include=defects').expect(200)).body.tasks as any[]).map((t) => t.id);
  const pmQueue = async () => (await get(f.users.pm, '/pm-review/queue').expect(200)).body;

  const newTask = async (values: Record<string, any> = {}) => {
    seq += 1;
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pA,
      projectName: 'Project A',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'Build',
      title: `PM gate task ${seq}`,
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

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_qa_review_artifacts, task_qa_review_qa_artifacts, task_dependency_tickets, task_blocking_defects, user_notifications, audit_logs RESTART IDENTITY CASCADE`);
    await ds.query(`UPDATE projects SET "pmReviewEnabled" = false`);
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

  describe('switch', () => {
    it('is off by default: a submit goes straight to QA, as before', async () => {
      const id = await newTask();
      await submit(id).expect(201);
      expect((await taskRow(id)).status).toBe('Feedback');
      expect((await rounds(id))[0].reviewType).toBe('qa');
    });

    it('only an Admin can see or change it (401 / 403)', async () => {
      await http().get('/pm-review/settings').expect(401);
      await http().patch(`/pm-review/projects/${f.projects.pA}`).send({ enabled: true }).expect(401);
      for (const u of [f.users.pm, f.users.devA, f.users.qaB]) {
        await get(u, '/pm-review/settings').expect(403);
        await setSwitch(u, f.projects.pA, true).expect(403);
      }
      const s = (await get(f.users.admin, '/pm-review/settings').expect(200)).body;
      expect(s.projects.find((p: any) => p.id === f.projects.pA).pmReviewEnabled).toBe(false);
      await setSwitch(f.users.admin, f.projects.pA, true).expect(200);
      const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'project_pm_review_switched' ORDER BY id DESC LIMIT 1`);
      expect(JSON.parse(audit.details)).toMatchObject({ from: false, to: true });
    });
  });

  describe('with the gate on (project A)', () => {
    let id: number;

    it('a submit waits for the PM, hidden from QA Review', async () => {
      id = await newTask();
      await submit(id).expect(201);
      const t = await taskRow(id);
      expect(t.status).toBe('Pending PM Review');
      expect(t.qaReviewDueDate).toBeNull();
      const [r1] = await rounds(id);
      expect(r1).toMatchObject({ reviewType: 'pm', status: 'pending', roundNumber: 1 });
      expect(await qaQueueIds()).not.toContain(id);
      const q = await pmQueue();
      expect(q.items.find((i: any) => i.taskId === id)).toMatchObject({ pmRound: 1, pmSendBacks: 0, assigneeName: 'Name devA' });
      expect(q.statCounts.pending).toBe(q.items.length);
      const [audit] = await ds.query(`SELECT action FROM audit_logs WHERE "entityId" = $1 AND "entityType" = 'ProjectTask' ORDER BY id DESC LIMIT 1`, [id]);
      expect(audit.action).toBe('task_pm_review_submitted');
    });

    it('blocks a second submit, QA decisions, and every other role (401 / 403)', async () => {
      expect((await submit(id).expect(400)).body.message).toMatch(/waiting for PM review/);
      expect((await patch(f.users.qaB, `/tasks/${id}/qa-approve`, {}).expect(403)).body.message).toMatch(/waiting for PM review/);
      await http().patch(`/pm-review/tasks/${id}/send-to-qa`).send({}).expect(401);
      await http().get('/pm-review/queue').expect(401);
      for (const u of [f.users.devA, f.users.qaB, f.users.exec]) {
        await sendToQa(u, id).expect(403);
        await sendBack(u, id).expect(403);
        await get(u, '/pm-review/queue').expect(403);
      }
      expect((await taskRow(id)).status).toBe('Pending PM Review');
    });

    it('send back needs feedback, then goes to PM Feedback - never counted as a QA rejection', async () => {
      await sendBack(f.users.pm, id, '<p>  </p>').expect(400);
      await sendBack(f.users.pm, id, '<p>Please add the API docs</p>').expect(200);
      expect((await taskRow(id)).status).toBe('PM Feedback');
      const [r1] = await rounds(id);
      expect(r1).toMatchObject({ reviewType: 'pm', status: 'rejected', reviewedByUserId: f.users.pm.id });
      expect(r1.qaComment).toMatch(/API docs/);
      // Not Team Tasks "Rejected", not QA's Rejected card, not the Summary.
      const team = (await get(f.users.pm, '/tasks/team').expect(200)).body;
      expect(team.tasks.find((t: any) => t.id === id)).toBeTruthy();
      const qa = (await get(f.users.pm, '/tasks/qa-queue?include=defects&status=Failed').expect(200)).body;
      expect(qa.tasks.map((t: any) => t.id)).not.toContain(id);
      const rejectedRows = (await get(f.users.pm, '/tasks/qa-summary/items?period=today&tile=rejected').expect(200)).body;
      expect(rejectedRows.map((r: any) => r.id)).not.toContain(id);
      await new Promise((r) => setTimeout(r, 200));
      const [note] = await ds.query(`SELECT type FROM user_notifications WHERE "userId" = $1 AND link = $2 ORDER BY id DESC LIMIT 1`, [f.users.devA.id, `/tasks/${id}`]);
      expect(note.type).toBe('task.pmSentBack');
    });

    it('the developer submits again and it returns to the PM queue (PM round 2)', async () => {
      await submit(id).expect(201);
      expect((await taskRow(id)).status).toBe('Pending PM Review');
      expect((await pmQueue()).items.find((i: any) => i.taskId === id)).toMatchObject({ pmRound: 2, pmSendBacks: 1 });
    });

    it('send to QA opens a first-time QA round with the same evidence; the second click loses', async () => {
      await sendToQa(f.users.pm, id, '<p>Looks complete</p>').expect(200);
      const t = await taskRow(id);
      expect(t.status).toBe('Feedback');
      expect(t.qaReviewDueDate).not.toBeNull();
      const all = await rounds(id);
      expect(all.map((r: any) => `${r.reviewType}:${r.status}`)).toEqual(['pm:rejected', 'pm:approved', 'qa:pending']);
      const qaRound = all[2];
      const copied = await ds.query(`SELECT type, url FROM task_qa_review_artifacts WHERE "taskQaReviewId" = $1`, [qaRound.id]);
      expect(copied).toEqual([{ type: 'Pull Request Link', url: 'https://example.com/pr/9' }]);
      expect(await qaQueueIds()).toContain(id);
      expect((await pmQueue()).items.map((i: any) => i.taskId)).not.toContain(id);
      expect((await sendToQa(f.users.admin, id).expect(400)).body.message).toMatch(/already sent it to QA/);
      // The QA summary's Waiting row shows no QA rejections.
      const waiting = (await get(f.users.pm, '/tasks/qa-summary/items?period=today&tile=waiting').expect(200)).body;
      expect(waiting.find((r: any) => r.id === id).rejections).toBe(0);
      // QA decides it normally.
      await patch(f.users.qaB, `/tasks/${id}/qa-approve`, {}).expect(200);
      expect((await taskRow(id)).status).toBe('Pass');
    });

    it('a resubmission after a QA rejection also goes through the PM, then to QA as Re-Feedback', async () => {
      const t = await newTask();
      await submit(t).expect(201);
      await sendToQa(f.users.pm, t).expect(200);
      await patch(f.users.qaB, `/tasks/${t}/qa-reject`, { comment: 'Broken' }).expect(200);
      await submit(t).expect(201);
      expect((await taskRow(t)).status).toBe('Pending PM Review');
      // Revert QA decision no longer applies - the task moved on.
      expect((await patch(f.users.pm, `/tasks/${t}/qa-revert`, { reason: 'mistake' }).expect(400)).body.message).toMatch(/moved on/);
      await sendToQa(f.users.admin, t).expect(200);
      expect((await taskRow(t)).status).toBe('Re-Feedback');
    });

    it('defects and Peer Review tasks skip the PM', async () => {
      const defect = await newTask({ isDefect: true, createdByUserId: f.users.qaB.id, createdByEmail: f.users.qaB.email });
      await submit(defect).expect(201);
      expect((await taskRow(defect)).status).toBe('Feedback');
      const peer = await newTask({ peerReviewEnabled: true });
      await post(f.users.devA, `/tasks/${peer}/peer-review-submit`, { resolution: 'x', actualHours: 1, artifacts, reviewerUserId: f.users.devNone.id }).expect(201);
      expect((await taskRow(peer)).status).toBe('Peer Review');
    });

    it('send to QA is blocked by a dependency opened while waiting; send back still works', async () => {
      const t = await newTask();
      await submit(t).expect(201);
      await ds.query(
        `INSERT INTO task_dependency_tickets ("tenantId", "parentTaskId", title, description, "ownerUserId", "ownerEmail", "createdByUserId", "createdByEmail", status)
         VALUES ($1, $2, 'Need API', 'x', $3, $4, $5, $6, 'open')`,
        [f.tenants.t1, t, f.users.devNone.id, f.users.devNone.email, f.users.devA.id, f.users.devA.email],
      );
      await sendToQa(f.users.pm, t).expect(400);
      expect((await taskRow(t)).status).toBe('Pending PM Review');
      await sendBack(f.users.pm, t).expect(200);
      expect((await taskRow(t)).status).toBe('PM Feedback');
    });

    it('no PM decision while the task is on Hold', async () => {
      const t = await newTask();
      await submit(t).expect(201);
      await ds.query(`UPDATE project_tasks SET status = 'Hold', "priorStatus" = 'Pending PM Review' WHERE id = $1`, [t]);
      expect((await sendToQa(f.users.pm, t).expect(400)).body.message).toMatch(/Hold/);
      expect((await pmQueue()).items.map((i: any) => i.taskId)).not.toContain(t);
    });

    it("PM time doesn't count against the developer: never overdue while waiting, due date shifts by the wait", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
      const t = await newTask({ dueDate: twoDaysAgo });
      const overdueIds = async () => {
        const team = (await get(f.users.pm, `/tasks/team?assigneeUserId=${f.users.devA.id}&pageSize=200`).expect(200)).body;
        return team.statCounts.overdue as number;
      };
      const before = await overdueIds();
      await submit(t).expect(201);
      expect(await overdueIds()).toBe(before - 1);
      // Pretend it waited since 10 days ago, then the PM sends it back.
      await ds.query(`UPDATE task_qa_reviews SET "submittedAt" = now() - interval '10 days' WHERE "taskId" = $1 AND status = 'pending'`, [t]);
      await sendBack(f.users.pm, t).expect(200);
      const row = await taskRow(t);
      const expectedWait = businessDaysBetween(new Date(Date.now() - 10 * 86400000), new Date());
      expect(row.pmWaitWorkingDays).toBe(expectedWait);
      expect(effectiveDueDate({ dueDate: twoDaysAgo, pmWaitWorkingDays: row.pmWaitWorkingDays })! >= today).toBe(true);
      expect(await overdueIds()).toBe(before - 1);
    });

    it('turning the switch off sends waiting tickets on to QA; PM Feedback tickets go straight to QA next time', async () => {
      const waiting = await newTask();
      await submit(waiting).expect(201);
      const feedback = await newTask();
      await submit(feedback).expect(201);
      await sendBack(f.users.pm, feedback).expect(200);

      const res = await setSwitch(f.users.admin, f.projects.pA, false).expect(200);
      expect(res.body.movedToQaTaskIds).toContain(waiting);
      expect((await taskRow(waiting)).status).toBe('Feedback');
      const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'task_pm_sent_to_qa' AND "entityId" = $1`, [waiting]);
      expect(JSON.parse(audit.details).source).toBe('switch-off');

      expect((await taskRow(feedback)).status).toBe('PM Feedback');
      await submit(feedback).expect(201);
      expect((await taskRow(feedback)).status).toBe('Feedback');
      // Only QA rounds decide Feedback vs Re-Feedback - the earlier PM round doesn't.
      expect((await rounds(feedback)).map((r: any) => `${r.reviewType}:${r.status}`)).toEqual(['pm:rejected', 'qa:pending']);
    });
  });

  it('KPI: PM send-backs are not QA rejections', async () => {
    const { KpiService } = await import('../src/kpi/kpi.service');
    await newTask({ dueDate: new Date().toISOString().slice(0, 10) });
    const rows = await app.get(KpiService).generatePeriod('daily', new Date(), f.tenants.t1);
    const mine = rows.find((r: any) => r.assigneeUserId === f.users.devA.id && r.projectId === f.projects.pA)!;
    const [{ qa, pm }] = await ds.query(
      `SELECT count(*) FILTER (WHERE r."reviewType" <> 'pm')::int AS qa, count(*) FILTER (WHERE r."reviewType" = 'pm')::int AS pm
         FROM task_qa_reviews r JOIN project_tasks t ON t.id = r."taskId"
        WHERE r.status = 'rejected' AND t."assigneeUserId" = $1 AND t."projectId" = $2`,
      [f.users.devA.id, f.projects.pA],
    );
    expect(pm).toBeGreaterThan(0);
    expect(mine.qaRejectionCount).toBe(qa);
  });

  describe('reminders and settings (Stage 3)', () => {
    it('reminder settings: Admin only, validated, audited; settings show waiting counts', async () => {
      await patch(f.users.pm, '/pm-review/reminder-settings', { workingDays: 3, toAdmin: true }).expect(403);
      await patch(f.users.admin, '/pm-review/reminder-settings', { workingDays: 0, toAdmin: true }).expect(400);
      await patch(f.users.admin, '/pm-review/reminder-settings', { workingDays: 2, toAdmin: true }).expect(200);
      await setSwitch(f.users.admin, f.projects.pA, true).expect(200);
      const t = await newTask();
      await submit(t).expect(201);
      const s = (await get(f.users.admin, '/pm-review/settings').expect(200)).body;
      expect(s.reminder).toEqual({ workingDays: 2, toAdmin: true });
      expect(s.projects.find((p: any) => p.id === f.projects.pA)).toMatchObject({ pmReviewEnabled: true, waitingCount: 1 });
    });

    it('the task page is told whether a submit goes to the PM first', async () => {
      const t = await newTask();
      expect((await get(f.users.devA, `/tasks/${t}`).expect(200)).body.pmReviewGateOn).toBe(true);
      const peer = await newTask({ peerReviewEnabled: true });
      expect((await get(f.users.devA, `/tasks/${peer}`).expect(200)).body.pmReviewGateOn).toBe(false);
      const other = await newTask({ projectId: f.projects.pB, projectName: 'Project B' });
      expect((await get(f.users.pm, `/tasks/${other}`).expect(200)).body.pmReviewGateOn).toBe(false);
    });

    it('reminds the PM after more than N working days, Admins after 2N, each once; skips Hold', async () => {
      const { PmReviewReminderService } = await import('../src/task-qa-reviews/pm-review-reminder.service');
      const reminders = app.get(PmReviewReminderService);
      const fresh = await newTask();
      await submit(fresh).expect(201);
      const late = await newTask();
      await submit(late).expect(201);
      const veryLate = await newTask();
      await submit(veryLate).expect(201);
      const held = await newTask();
      await submit(held).expect(201);
      const backdate = (id: number, days: number) =>
        ds.query(`UPDATE task_qa_reviews SET "submittedAt" = now() - ($2 || ' days')::interval WHERE "taskId" = $1 AND status = 'pending'`, [id, String(days)]);
      // Calendar days chosen so the working-day count is safely past N=2 / 2N=4.
      await backdate(late, 6);
      await backdate(veryLate, 14);
      await backdate(held, 14);
      await ds.query(`UPDATE project_tasks SET status = 'Hold', "priorStatus" = 'Pending PM Review' WHERE id = $1`, [held]);

      const first = await reminders.remindTenant(f.tenants.t1, new Date());
      expect(first.pm.sort()).toEqual([late, veryLate].sort());
      expect(first.admin).toEqual([veryLate]);
      const again = await reminders.remindTenant(f.tenants.t1, new Date());
      expect(again).toEqual({ pm: [], admin: [] });

      await new Promise((r) => setTimeout(r, 300));
      const pmNotes = await ds.query(`SELECT "userId" FROM user_notifications WHERE type = 'task.pmReviewReminder' AND link = $1`, [`/tasks/${veryLate}#pm-review`]);
      expect(pmNotes.map((n: any) => n.userId).sort()).toEqual([f.users.pm.id, f.users.admin.id].sort());

      // Admin reminder switched off: no admin level for a new very late one.
      await patch(f.users.admin, '/pm-review/reminder-settings', { workingDays: 2, toAdmin: false }).expect(200);
      const another = await newTask();
      await submit(another).expect(201);
      await backdate(another, 14);
      expect(await reminders.remindTenant(f.tenants.t1, new Date())).toEqual({ pm: [another], admin: [] });
    });
  });

  describe('clock helpers', () => {
    it('effectiveDueDate adds the PM wait in working days; Pending PM Review is never past due', () => {
      expect(effectiveDueDate({ dueDate: '2026-10-09', pmWaitWorkingDays: 0 })).toBe('2026-10-09');
      // Friday + 1 working day = Monday.
      expect(effectiveDueDate({ dueDate: '2026-10-09', pmWaitWorkingDays: 1 })).toBe('2026-10-12');
      expect(isPastEffectiveDue({ status: 'Pending PM Review', dueDate: '2026-01-01', pmWaitWorkingDays: 0 }, '2026-10-13')).toBe(false);
      expect(isPastEffectiveDue({ status: 'Development', dueDate: '2026-10-09', pmWaitWorkingDays: 1 }, '2026-10-12')).toBe(false);
      expect(isPastEffectiveDue({ status: 'Development', dueDate: '2026-10-09', pmWaitWorkingDays: 1 }, '2026-10-13')).toBe(true);
      expect(businessDaysBetween(new Date('2026-10-09T10:00:00Z'), new Date('2026-10-12T09:00:00Z'))).toBe(1);
      expect(businessDaysBetween(new Date('2026-10-12T10:00:00Z'), new Date('2026-10-12T18:00:00Z'))).toBe(0);
    });
  });
});
