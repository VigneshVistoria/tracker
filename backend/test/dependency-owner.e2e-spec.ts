import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Change the owner of a dependency ticket (2026-10-14): PM/Admin only,
// open tickets only, Developer/Designer/DevOps owners only, never the
// filer, never empty. Every change is audited, shown in the task's
// dependency history, and notifies the new owner in-app.
describe('Dependency ticket owner change (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let devC: FixtureUser;
  let designer: FixtureUser;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const changeOwner = (u: FixtureUser, id: number, ownerUserId: any) => patch(u, `/task-dependency-tickets/${id}/owner`, { ownerUserId });
  const ticketRow = async (id: number) => (await ds.query(`SELECT * FROM task_dependency_tickets WHERE id = $1`, [id]))[0];

  const notificationsFor = async (u: FixtureUser, expectAtLeast: number) => {
    const q = () => ds.query(`SELECT * FROM "user_notifications" WHERE "userId" = $1 AND "type" = 'dependency.assigned' ORDER BY id`, [u.id]);
    for (let i = 0; i < 20; i++) {
      const rows = await q();
      if (rows.length >= expectAtLeast) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return q();
  };

  const addUser = async (key: string, role: string): Promise<FixtureUser> => {
    const email = `${key}@test.local`;
    const row = (
      await ds.query(
        `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
        [f.tenants.t1, email, `Name ${key}`, role],
      )
    )[0];
    return { id: row.id, email, tenantId: f.tenants.t1, role };
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
      title: `Dep owner task ${seq}`,
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

  // A task assigned to devA with one open ticket devA filed, owned by devNone.
  const newTicket = async () => {
    const taskId = await newTask();
    const res = await post(f.users.devA, '/task-dependency-tickets', {
      parentTaskId: taskId,
      title: 'Need the API',
      description: 'Blocked on the claims API',
      ownerUserId: f.users.devNone.id,
    }).expect(201);
    return { taskId, ticketId: res.body.id as number };
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_qa_review_artifacts, task_qa_review_qa_artifacts, task_dependency_tickets, task_blocking_defects, user_notifications, audit_logs RESTART IDENTITY CASCADE`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    devC = await addUser('devC', 'developer');
    designer = await addUser('designerD', 'designer');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a request with no login (401)', async () => {
    const { ticketId } = await newTicket();
    await http().patch(`/task-dependency-tickets/${ticketId}/owner`).send({ ownerUserId: devC.id }).expect(401);
    await http().get(`/task-dependency-tickets/history?parentTaskId=1`).expect(401);
  });

  it('rejects every role except PM and Admin (403), including the owner and the filer', async () => {
    const { ticketId } = await newTicket();
    for (const u of [f.users.devA, f.users.devNone, f.users.qaB, f.users.exec, f.users.clientA]) {
      await changeOwner(u, ticketId, devC.id).expect(403);
    }
    expect((await ticketRow(ticketId)).ownerUserId).toBe(f.users.devNone.id);
  });

  it('PM changes the owner: row, audit entry, notification and history all updated', async () => {
    const { taskId, ticketId } = await newTicket();
    const res = await changeOwner(f.users.pm, ticketId, devC.id).expect(200);
    expect(res.body.ownerUserId).toBe(devC.id);
    expect(res.body.ownerName).toBe('Name devC');

    const row = await ticketRow(ticketId);
    expect(row.ownerUserId).toBe(devC.id);
    expect(row.ownerEmail).toBe(devC.email);
    expect(row.status).toBe('open');

    const audit = await ds.query(
      `SELECT * FROM audit_logs WHERE action = 'task_dependency_ticket_owner_changed' AND "entityId" = $1`,
      [ticketId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].userId).toBe(f.users.pm.id);
    expect(JSON.parse(audit[0].details)).toMatchObject({
      parentTaskId: taskId,
      previousOwnerUserId: f.users.devNone.id,
      previousOwnerName: 'Name devNone',
      ownerUserId: devC.id,
      ownerName: 'Name devC',
    });

    const notes = await notificationsFor(devC, 1);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe(`Dependency on task #${taskId} reassigned to you`);

    // Moves between the old and new owner's "others waiting on you" lists.
    expect((await get(devC, '/task-dependency-tickets/mine').expect(200)).body.map((t: any) => t.id)).toContain(ticketId);
    expect((await get(f.users.devNone, '/task-dependency-tickets/mine').expect(200)).body.map((t: any) => t.id)).not.toContain(ticketId);

    const history = (await get(f.users.devA, `/task-dependency-tickets/history?parentTaskId=${taskId}`).expect(200)).body;
    expect(history.map((h: any) => h.action)).toEqual(['task_dependency_ticket_created', 'task_dependency_ticket_owner_changed']);
    expect(history[0]).toMatchObject({ ticketId, actorName: 'Name devA', ownerName: 'Name devNone' });
    expect(history[1]).toMatchObject({ ticketId, actorName: 'Name pm', previousOwnerName: 'Name devNone', ownerName: 'Name devC' });

    // The task page's ticket list shows names.
    const list = (await get(f.users.pm, `/task-dependency-tickets?parentTaskId=${taskId}`).expect(200)).body;
    expect(list[0]).toMatchObject({ ownerName: 'Name devC', createdByName: 'Name devA' });
  });

  it('Admin can change the owner, including to a Designer', async () => {
    const { ticketId } = await newTicket();
    await changeOwner(f.users.admin, ticketId, designer.id).expect(200);
    expect((await ticketRow(ticketId)).ownerUserId).toBe(designer.id);
  });

  it('rejects invalid targets without changing anything', async () => {
    const { ticketId } = await newTicket();
    const before = await ticketRow(ticketId);
    await changeOwner(f.users.pm, ticketId, f.users.devNone.id).expect(400); // same owner
    await changeOwner(f.users.pm, ticketId, f.users.devA.id).expect(400); // the filer
    for (const u of [f.users.clientA, f.users.qaB, f.users.pm, f.users.exec]) {
      await changeOwner(f.users.pm, ticketId, u.id).expect(400); // not Developer/Designer/DevOps
    }
    await changeOwner(f.users.pm, ticketId, f.users.pmT2.id).expect(404); // other tenant
    await changeOwner(f.users.pm, ticketId, 999999).expect(404);
    await changeOwner(f.users.pm, ticketId, null).expect(400); // no "remove owner"
    await changeOwner(f.users.pm, ticketId, 'abc').expect(400);
    await changeOwner(f.users.pm, 999999, devC.id).expect(404);
    expect(await ticketRow(ticketId)).toEqual(before);
    const audit = await ds.query(`SELECT * FROM audit_logs WHERE action = 'task_dependency_ticket_owner_changed' AND "entityId" = $1`, [ticketId]);
    expect(audit).toHaveLength(0);
  });

  it('blocks a resolved ticket and a ticket on a Junk task', async () => {
    const { ticketId } = await newTicket();
    await patch(f.users.pm, `/task-dependency-tickets/${ticketId}/resolve`).expect(200);
    await changeOwner(f.users.pm, ticketId, devC.id).expect(400);

    const junk = await newTicket();
    await ds.query(`UPDATE project_tasks SET status = 'Junk' WHERE id = $1`, [junk.taskId]);
    await changeOwner(f.users.pm, junk.ticketId, devC.id).expect(400);
    expect((await ticketRow(junk.ticketId)).ownerUserId).toBe(f.users.devNone.id);
  });

  it('the open ticket still blocks QA submission after the owner changes', async () => {
    const { taskId, ticketId } = await newTicket();
    await changeOwner(f.users.pm, ticketId, devC.id).expect(200);
    const res = await post(f.users.devA, `/tasks/${taskId}/qa-submit`, {
      resolution: '<p>Done</p>',
      actualHours: 3,
      artifacts: [{ type: 'Pull Request Link', url: 'https://example.com/pr/1' }],
    }).expect(400);
    expect(res.body.message).toContain(`#${ticketId}`);
  });

  it('history follows the task view rule', async () => {
    const { taskId } = await newTicket();
    await get(f.users.qaB, `/task-dependency-tickets/history?parentTaskId=${taskId}`).expect(403); // QA not on Project A
    await get(f.users.clientA, `/task-dependency-tickets/history?parentTaskId=${taskId}`).expect(403);
    await get(f.users.devNone, `/task-dependency-tickets/history?parentTaskId=${taskId}`).expect(200); // ticket owner
    await get(f.users.exec, `/task-dependency-tickets/history?parentTaskId=${taskId}`).expect(200);
  });
});
