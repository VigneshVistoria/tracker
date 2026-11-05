import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { KpiService } from '../src/kpi/kpi.service';
import { DEPENDENCY_TASK_RESOLVED_STATUSES, DEPENDENCY_TASK_CANCELLED_STATUS } from '../src/task-dependency-tickets/dependency-tasks';

// Dependency tasks Stage 1 (Option B, decisions from the user 2026-11-05):
// per-project switch (Admin/PM, default off); with it on, a ticket with an
// internal owner gets one linked task; light flow (owner's Resolve -> Pass,
// requester notified, never reviewed); the ticket follows the task's status
// on every path (trigger); reassigned only through the ticket owner; left
// out of KPI; progress notes work with tracking off.
describe('Dependency tasks (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let devC: FixtureUser;
  let seq = 0;
  const SUBMIT = { resolution: '<p>Done</p>', actualHours: 3, artifacts: [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }] };

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const ticketRow = async (id: number) => (await ds.query(`SELECT * FROM task_dependency_tickets WHERE id = $1`, [id]))[0];
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const depTaskFor = async (ticketId: number) => (await ds.query(`SELECT *, "dueDate"::text AS "dueDate" FROM project_tasks WHERE "dependencyTicketId" = $1`, [ticketId]))[0];
  const setSwitch = (on: boolean) => ds.query(`UPDATE projects SET "dependencyTasksEnabled" = $1 WHERE id = $2`, [on, f.projects.pA]);
  const setTracking = (on: boolean) =>
    ds.query(`UPDATE projects SET "performanceTrackingEnabled" = $1, "performanceTrackingSince" = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2`, [on, f.projects.pA]);

  const waitFor = async <T>(q: () => Promise<T[]>, atLeast = 1): Promise<T[]> => {
    for (let i = 0; i < 20; i++) {
      const rows = await q();
      if (rows.length >= atLeast) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return q();
  };

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
      title: `Parent task ${seq}`,
      description: 'x',
      status: 'Development',
      estimatedHours: 4,
      dueDate: '2026-12-31',
      priority: 'High',
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

  // devA (parent's assignee) files a ticket owned by devC.
  const newTicket = async (extra: Record<string, any> = {}) => {
    const parentId = await newTask();
    const res = await post(f.users.devA, '/task-dependency-tickets', {
      parentTaskId: parentId,
      title: 'Need the claims API',
      description: 'Blocked on the claims API endpoint',
      ownerUserId: devC.id,
      ...extra,
    }).expect(201);
    return { parentId, ticketId: res.body.id as number, dependencyTaskId: res.body.dependencyTaskId as number | null };
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_progress_notes, user_notifications, audit_logs RESTART IDENTITY CASCADE`,
    );
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    const row = (
      await ds.query(
        `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, 'devC@test.local', 'x', 'Name devC', 'developer') RETURNING id`,
        [f.tenants.t1],
      )
    )[0];
    devC = { id: row.id, email: 'devC@test.local', tenantId: f.tenants.t1, role: 'developer' };
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    await setSwitch(false);
    await setTracking(false);
  });

  describe('per-project switch', () => {
    it('is off by default and needs a login (401)', async () => {
      const project = (await ds.query(`SELECT "dependencyTasksEnabled" FROM projects WHERE id = $1`, [f.projects.pB]))[0];
      expect(project.dependencyTasksEnabled).toBe(false);
      await http().get('/task-dependency-tickets/projects').expect(401);
      await http().patch(`/task-dependency-tickets/projects/${f.projects.pA}`).send({ enabled: true }).expect(401);
    });

    it('only Admin and Program Manager can see or switch it (403)', async () => {
      for (const u of [f.users.devA, f.users.qaB, f.users.exec, f.users.clientA]) {
        await get(u, '/task-dependency-tickets/projects').expect(403);
        await patch(u, `/task-dependency-tickets/projects/${f.projects.pA}`, { enabled: true }).expect(403);
      }
      const still = (await ds.query(`SELECT "dependencyTasksEnabled" FROM projects WHERE id = $1`, [f.projects.pA]))[0];
      expect(still.dependencyTasksEnabled).toBe(false);
    });

    it('PM and Admin switch it on and off, audited; other tenants and bad bodies refused', async () => {
      const list = await get(f.users.pm, '/task-dependency-tickets/projects').expect(200);
      expect(list.body.find((p: any) => p.id === f.projects.pA)).toEqual({ id: f.projects.pA, name: 'Project A', dependencyTasksEnabled: false });
      expect(list.body.some((p: any) => p.id === f.projects.pT2)).toBe(false);

      await patch(f.users.pm, `/task-dependency-tickets/projects/${f.projects.pA}`, { enabled: true }).expect(200);
      await patch(f.users.admin, `/task-dependency-tickets/projects/${f.projects.pA}`, { enabled: false }).expect(200);
      await patch(f.users.pm, `/task-dependency-tickets/projects/${f.projects.pA}`, { enabled: 'yes' }).expect(400);
      await patch(f.users.pm, `/task-dependency-tickets/projects/${f.projects.pT2}`, { enabled: true }).expect(404);

      const audits = await ds.query(
        `SELECT details FROM audit_logs WHERE action = 'dependency_tasks_project_switched' AND "entityId" = $1 ORDER BY id`,
        [f.projects.pA],
      );
      expect(audits.map((a: any) => JSON.parse(a.details))).toEqual([{ from: false, to: true }, { from: true, to: false }]);
    });
  });

  describe('creating a ticket', () => {
    it('switch off: no task, exactly as before', async () => {
      const { ticketId, dependencyTaskId } = await newTicket();
      expect(dependencyTaskId).toBeNull();
      expect(await depTaskFor(ticketId)).toBeUndefined();
    });

    it('switch on: exactly one task for the owner, with the parent project/module/phase, in Development', async () => {
      await setSwitch(true);
      const { parentId, ticketId, dependencyTaskId } = await newTicket();
      const task = await depTaskFor(ticketId);
      expect(task.id).toBe(dependencyTaskId);
      expect(task).toMatchObject({
        dependencyTicketId: ticketId,
        assigneeUserId: devC.id,
        assigneeEmail: devC.email,
        createdByUserId: f.users.devA.id,
        projectId: f.projects.pA,
        moduleId: f.modules.mA,
        phaseId,
        title: 'Need the claims API',
        status: 'Development',
        estimatedHours: null,
        dueDate: null,
        dueDateCommittedByUserId: null,
        isDefect: false,
        parentTaskId: null,
        peerReviewEnabled: false,
        priority: 'High',
      });
      expect((await ds.query(`SELECT count(*)::int AS n FROM project_tasks WHERE "dependencyTicketId" = $1`, [ticketId]))[0].n).toBe(1);
      const audit = await ds.query(`SELECT details FROM audit_logs WHERE action = 'dependency_task_created' AND "entityId" = $1`, [task.id]);
      expect(JSON.parse(audit[0].details)).toMatchObject({ dependencyTicketId: ticketId, parentTaskId: parentId, assigneeUserId: devC.id });
      // The owner and the requester can both open it.
      await get(devC, `/tasks/${task.id}`).expect(200);
      await get(f.users.devA, `/tasks/${task.id}`).expect(200);
    });

    it('with tracking on, the due date starts as the needed-by date, not yet committed by the owner', async () => {
      await setSwitch(true);
      await setTracking(true);
      const { ticketId } = await newTicket({ needByDate: '2027-01-15' });
      const task = await depTaskFor(ticketId);
      expect(task.dueDate).toBe('2027-01-15');
      expect(task.dueDateCommittedByUserId).toBeNull();
    });

    it('a ticket and its task are only ever made together', async () => {
      await setSwitch(true);
      const before = (await ds.query(`SELECT count(*)::int AS n FROM task_dependency_tickets`))[0].n;
      // A bad owner fails before anything is written.
      const parentId = await newTask();
      await post(f.users.devA, '/task-dependency-tickets', { parentTaskId: parentId, title: 't', description: 'd', ownerUserId: f.users.qaB.id }).expect(400);
      expect((await ds.query(`SELECT count(*)::int AS n FROM task_dependency_tickets`))[0].n).toBe(before);
      expect((await ds.query(`SELECT count(*)::int AS n FROM task_dependency_tickets t WHERE NOT EXISTS (SELECT 1 FROM project_tasks p WHERE p."dependencyTicketId" = t.id) AND t."createdAt" > now() - interval '1 minute' AND t.id > $1`, [before]))[0].n).toBe(0);
    });
  });

  describe('light flow', () => {
    it('cannot be submitted for QA or Peer Review', async () => {
      await setSwitch(true);
      const { dependencyTaskId } = await newTicket();
      await ds.query(`UPDATE project_tasks SET "estimatedHours" = 3, "dueDate" = '2026-12-20' WHERE id = $1`, [dependencyTaskId]);
      const qa = await post(devC, `/tasks/${dependencyTaskId}/qa-submit`, SUBMIT).expect(400);
      expect(qa.body.message).toContain('dependency task');
      await post(devC, `/tasks/${dependencyTaskId}/peer-review-submit`, { ...SUBMIT, reviewerUserId: f.users.devA.id }).expect(400);
      // Nor can a PM switch Peer Review on for it.
      const flag = await patch(f.users.pm, `/tasks/${dependencyTaskId}/peer-review-flag`, { peerReviewEnabled: true });
      expect(flag.status).toBe(400);
      expect(JSON.stringify(flag.body)).toContain('dependency task');
      expect((await taskRow(dependencyTaskId!)).status).toBe('Development');
    });

    it("the owner's Resolve moves it straight to Pass, resolves the ticket and tells the requester", async () => {
      await setSwitch(true);
      const { parentId, ticketId, dependencyTaskId } = await newTicket();
      await patch(devC, `/task-dependency-tickets/${ticketId}/resolve`).expect(200);
      const task = await taskRow(dependencyTaskId!);
      expect(task.status).toBe('Pass');
      expect(task.completedAt).not.toBeNull();
      const ticket = await ticketRow(ticketId);
      expect(ticket.status).toBe('resolved');
      expect(ticket.resolvedAt).not.toBeNull();
      const notes = await waitFor(() =>
        ds.query(`SELECT * FROM user_notifications WHERE "userId" = $1 AND type = 'dependency.resolved' AND link = $2`, [f.users.devA.id, `/tasks/${parentId}`]),
      );
      expect(notes.length).toBe(1);
      expect((await ds.query(`SELECT count(*)::int AS n FROM task_qa_reviews WHERE "taskId" = $1`, [dependencyTaskId]))[0].n).toBe(0);
      await patch(devC, `/task-dependency-tickets/${ticketId}/resolve`).expect(400);
    });

    it('only the owner, PM or Admin can resolve (403)', async () => {
      await setSwitch(true);
      const { ticketId, dependencyTaskId } = await newTicket();
      for (const u of [f.users.devA, f.users.qaB, f.users.exec]) {
        await patch(u, `/task-dependency-tickets/${ticketId}/resolve`).expect(403);
      }
      expect((await taskRow(dependencyTaskId!)).status).toBe('Development');
      await patch(f.users.pm, `/task-dependency-tickets/${ticketId}/resolve`).expect(200);
      expect((await taskRow(dependencyTaskId!)).status).toBe('Pass');
    });
  });

  describe('the ticket follows the task status (trigger)', () => {
    it('reopening a resolved task blocks the parent again; Closed and Released resolve; Hold leaves it', async () => {
      await setSwitch(true);
      const { ticketId, dependencyTaskId } = await newTicket();
      await patch(devC, `/task-dependency-tickets/${ticketId}/resolve`).expect(200);

      await ds.query(`UPDATE project_tasks SET status = 'Development' WHERE id = $1`, [dependencyTaskId]);
      let ticket = await ticketRow(ticketId);
      expect(ticket.status).toBe('open');
      expect(ticket.resolvedAt).toBeNull();

      await ds.query(`UPDATE project_tasks SET status = 'Hold' WHERE id = $1`, [dependencyTaskId]);
      expect((await ticketRow(ticketId)).status).toBe('open');

      await ds.query(`UPDATE project_tasks SET status = 'Closed' WHERE id = $1`, [dependencyTaskId]);
      ticket = await ticketRow(ticketId);
      expect(ticket.status).toBe('resolved');
      expect(ticket.resolvedAt).not.toBeNull();

      await ds.query(`UPDATE project_tasks SET status = 'Development' WHERE id = $1`, [dependencyTaskId]);
      await ds.query(`UPDATE project_tasks SET status = 'Released - No Showstoppers' WHERE id = $1`, [dependencyTaskId]);
      expect((await ticketRow(ticketId)).status).toBe('resolved');
    });

    it('Junk cancels the ticket (unblocks, stops metrics), restoring reopens it', async () => {
      await setSwitch(true);
      const { ticketId, dependencyTaskId } = await newTicket();
      await ds.query(
        `UPDATE project_tasks SET "statusBeforeJunk" = status, status = 'Junk', "junkReason" = 'Not needed any more', "junkedByUserId" = $2 WHERE id = $1`,
        [dependencyTaskId, f.users.pm.id],
      );
      let ticket = await ticketRow(ticketId);
      expect(ticket).toMatchObject({ status: 'cancelled', cancelledByUserId: f.users.pm.id, cancelReason: 'Dependency task moved to Junk: Not needed any more' });
      expect(ticket.cancelledAt).not.toBeNull();
      expect(ticket.resolvedAt).not.toBeNull();
      await patch(devC, `/task-dependency-tickets/${ticketId}/resolve`).expect(400);

      await ds.query(`UPDATE project_tasks SET status = 'Development' WHERE id = $1`, [dependencyTaskId]);
      ticket = await ticketRow(ticketId);
      expect(ticket).toMatchObject({ status: 'open', cancelledAt: null, cancelledByUserId: null, cancelReason: null, resolvedAt: null });
    });

    it('ordinary tasks are untouched by the trigger', async () => {
      const { ticketId } = await newTicket();
      const plainId = await newTask();
      await ds.query(`UPDATE project_tasks SET status = 'Pass' WHERE id = $1`, [plainId]);
      expect((await ticketRow(ticketId)).status).toBe('open');
    });

    it('owner check: a user owner or a free-text external owner, never both or neither', async () => {
      const { ticketId } = await newTicket();
      const bad = [
        `UPDATE task_dependency_tickets SET "ownerExternal" = 'City office' WHERE id = $1`,
        `UPDATE task_dependency_tickets SET "ownerUserId" = NULL WHERE id = $1`,
        `UPDATE task_dependency_tickets SET "ownerUserId" = NULL, "ownerEmail" = NULL, "ownerExternal" = '  ' WHERE id = $1`,
      ];
      for (const q of bad) await expect(ds.query(q, [ticketId])).rejects.toThrow(/CHK_task_dependency_tickets_owner/);
      await ds.query(`UPDATE task_dependency_tickets SET "ownerUserId" = NULL, "ownerEmail" = NULL, "ownerExternal" = 'City office' WHERE id = $1`, [ticketId]);
      expect(await ticketRow(ticketId)).toMatchObject({ ownerUserId: null, ownerEmail: null, ownerExternal: 'City office' });
    });

    it('the status lists match the trigger in the migration', () => {
      const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-11-dependency-tasks.sql'), 'utf8');
      const resolvedLine = sql.split('\n').find((l) => l.includes(`IF NEW."status" IN (`))!;
      const inSql = resolvedLine.slice(resolvedLine.indexOf('(') + 1, resolvedLine.lastIndexOf(')')).split(',').map((x) => x.trim().replace(/'/g, ''));
      expect(inSql).toEqual(DEPENDENCY_TASK_RESOLVED_STATUSES);
      expect(sql).toContain(`ELSIF NEW."status" = '${DEPENDENCY_TASK_CANCELLED_STATUS}' THEN`);
    });
  });

  describe('reassignment', () => {
    it('only through the ticket owner: task-side reassign and handover are refused', async () => {
      await setSwitch(true);
      const { dependencyTaskId } = await newTicket();
      const res = await patch(f.users.pm, `/tasks/${dependencyTaskId}/reassign`, { assigneeUserId: f.users.devNone.id }).expect(400);
      expect(res.body.message).toContain('change the owner on its dependency ticket');
      expect((await taskRow(dependencyTaskId!)).assigneeUserId).toBe(devC.id);
    });

    it('changing the ticket owner reassigns the task too, audited', async () => {
      await setSwitch(true);
      const { ticketId, dependencyTaskId } = await newTicket();
      await patch(f.users.pm, `/task-dependency-tickets/${ticketId}/owner`, { ownerUserId: f.users.devNone.id }).expect(200);
      const task = await taskRow(dependencyTaskId!);
      expect(task.assigneeUserId).toBe(f.users.devNone.id);
      expect(task.assigneeEmail).toBe(f.users.devNone.email);
      const audit = await ds.query(`SELECT details FROM audit_logs WHERE action = 'dependency_task_reassigned' AND "entityId" = $1`, [dependencyTaskId]);
      expect(JSON.parse(audit[0].details)).toMatchObject({ dependencyTicketId: ticketId, previousAssigneeUserId: devC.id, assigneeUserId: f.users.devNone.id });
    });
  });

  describe('Stage 2: ticket lists show the linked task', () => {
    it('parent page, owner inbox and requester list carry status ("In progress"), estimate, due date and latest note', async () => {
      await setSwitch(true);
      const { parentId, ticketId, dependencyTaskId } = await newTicket();
      await http().patch(`/tasks/${dependencyTaskId}`).set(auth(devC)).send({ estimatedHours: 16, dueDate: '2026-12-20' }).expect(200);
      await post(devC, `/tasks/${dependencyTaskId}/activity/notes`, { body: 'Started on the claims endpoint today.' }).expect(201);
      await post(devC, `/tasks/${dependencyTaskId}/activity/notes`, { body: 'Endpoint ready, testing.' }).expect(201);
      const expected = {
        id: dependencyTaskId,
        status: 'Development',
        statusLabel: 'In progress',
        assigneeUserId: devC.id,
        estimatedHours: 16,
        dueDate: '2026-12-20',
        lastProgressNote: { body: 'Endpoint ready, testing.' },
      };
      const forParent = (await get(f.users.devA, `/task-dependency-tickets?parentTaskId=${parentId}`).expect(200)).body;
      expect(forParent.find((t: any) => t.id === ticketId).dependencyTask).toMatchObject(expected);
      expect(forParent.find((t: any) => t.id === ticketId).dependencyTask.dueDateCommittedAt).not.toBeNull();
      const mine = (await get(devC, '/task-dependency-tickets/mine').expect(200)).body;
      expect(mine.find((t: any) => t.id === ticketId).dependencyTask).toMatchObject(expected);
      const sent = (await get(f.users.devA, '/task-dependency-tickets/created-by-me').expect(200)).body;
      expect(sent.find((t: any) => t.id === ticketId).dependencyTask).toMatchObject(expected);

      await patch(devC, `/task-dependency-tickets/${ticketId}/resolve`).expect(200);
      const after = (await get(devC, '/task-dependency-tickets/mine').expect(200)).body;
      expect(after.find((t: any) => t.id === ticketId).dependencyTask).toMatchObject({ status: 'Pass', statusLabel: 'Pass' });
    });

    it('a ticket without a task (switch off) has dependencyTask null', async () => {
      const { parentId, ticketId, dependencyTaskId } = await newTicket();
      expect(dependencyTaskId).toBeNull();
      const forParent = (await get(f.users.devA, `/task-dependency-tickets?parentTaskId=${parentId}`).expect(200)).body;
      expect(forParent.find((t: any) => t.id === ticketId).dependencyTask).toBeNull();
    });

    it('GET /task-dependency-tickets/:id: requester, owner and PM yes; others 403; other tenant 404; no login 401', async () => {
      await setSwitch(true);
      const { parentId, ticketId, dependencyTaskId } = await newTicket();
      await http().get(`/task-dependency-tickets/${ticketId}`).expect(401);
      for (const u of [f.users.devA, devC, f.users.pm]) {
        const res = await get(u, `/task-dependency-tickets/${ticketId}`).expect(200);
        expect(res.body).toMatchObject({ id: ticketId, parentTaskId: parentId, parentTaskTitle: expect.any(String), ownerName: 'Name devC', dependencyTask: { id: dependencyTaskId, statusLabel: 'In progress' } });
      }
      await get(f.users.devNone, `/task-dependency-tickets/${ticketId}`).expect(403);
      await get(f.users.pmT2, `/task-dependency-tickets/${ticketId}`).expect(404);
      await get(f.users.devA, '/task-dependency-tickets/999999').expect(404);
    });
  });

  describe('progress notes', () => {
    it('the owner can add notes on a dependency task even with tracking off; ordinary tasks still need tracking', async () => {
      await setSwitch(true);
      const { dependencyTaskId } = await newTicket();
      const state = await get(devC, `/tasks/${dependencyTaskId}/activity`).expect(200);
      expect(state.body).toMatchObject({ trackingOn: false, dependencyTask: true, canAddNote: true, canChase: false });
      await post(devC, `/tasks/${dependencyTaskId}/activity/notes`, { body: 'Endpoint drafted, wiring auth next.' }).expect(201);
      expect((await ds.query(`SELECT count(*)::int AS n FROM task_progress_notes WHERE "taskId" = $1`, [dependencyTaskId]))[0].n).toBe(1);
      // Only the assignee writes progress notes.
      await post(f.users.devA, `/tasks/${dependencyTaskId}/activity/notes`, { body: 'Requester trying to add a note.' }).expect(403);

      const plainId = await newTask({ assigneeUserId: devC.id, assigneeEmail: devC.email });
      expect((await get(devC, `/tasks/${plainId}/activity`).expect(200)).body).toEqual({ trackingOn: false });
      await post(devC, `/tasks/${plainId}/activity/notes`, { body: 'This should be refused here.' }).expect(400);
    });
  });

  describe('scores', () => {
    it('KPI leaves dependency tasks out (an overdue one counts for nothing)', async () => {
      await setSwitch(true);
      const { dependencyTaskId } = await newTicket();
      await ds.query(`UPDATE project_tasks SET "dueDate" = '2026-11-02', "estimatedHours" = 2 WHERE id = $1`, [dependencyTaskId]);
      const kpi = app.get(KpiService) as any;
      const range = kpi.resolveRange('monthly', new Date('2026-11-15T12:00:00Z'));
      const config = await kpi.getOrCreateConfigRow(f.tenants.t1);
      const metrics = await kpi.computeMetrics(f.tenants.t1, f.projects.pA, devC.id, range, config);
      expect(metrics.ticketsDue).toBe(0);

      // Same task without the link would count.
      await ds.query(`UPDATE project_tasks SET "dependencyTicketId" = NULL WHERE id = $1`, [dependencyTaskId]);
      const plain = await kpi.computeMetrics(f.tenants.t1, f.projects.pA, devC.id, range, config);
      expect(plain.ticketsDue).toBe(1);
    });
  });
});
