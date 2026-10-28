import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { FLAG_CLEARING_STATUSES, TASK_FLAG_AUDIT, needByOverdueAt } from '../src/task-flags/task-flags';

// Performance Tracking S3 (2026-10-28): risk and blocker flags and the
// dependency needed-by date. OFF = nothing changes. ON = the assignee or a
// PM/Admin sets a risk (reason; raised date automatic; likely date for
// information only) or a blocker (reason + a tracker user or an external
// party; optional dependency link); one open of each kind; setter/
// assignee/PM/Admin (and the blocking owner) clear; who set it is kept;
// Pass/Junk/Closed/Released clear open flags. A dependency needs a
// needed-by date when filed; only the creator or a PM/Admin changes it,
// with a reason - never the owner.
describe('Task flags + dependency needed-by (Performance Tracking S3, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const flagsOf = (taskId: number) => ds.query(`SELECT * FROM task_flags WHERE "taskId" = $1 ORDER BY id`, [taskId]);
  const audits = (entityType: string, id: number, action: string) =>
    ds.query(`SELECT * FROM audit_logs WHERE "entityType" = $1 AND "entityId" = $2 AND action = $3 ORDER BY id`, [entityType, id, action]);
  const notified = async (userId: number, type: string, taskId: number) => {
    for (let i = 0; i < 40; i++) {
      const rows = await ds.query(`SELECT 1 FROM user_notifications WHERE "userId" = $1 AND type = $2 AND link = $3`, [userId, type, `/tasks/${taskId}#flags`]);
      if (rows.length) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const setTracking = (projectId: number, enabled: boolean) => patch(f.users.pm, `/performance-tracking/projects/${projectId}`, { enabled }).expect(200);
  const newTask = async (title: string, assignee: FixtureUser = f.users.devA) =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail", "dueDate")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', $5, 'x', 'Development', $6, $7, $8, $9, '2026-12-10') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, title, assignee.id, assignee.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;
  const risk = (u: FixtureUser, taskId: number, extra: any = {}) =>
    post(u, '/task-flags', { taskId, kind: 'risk', reason: 'Payment API sandbox is unstable', ...extra });
  const blocker = (u: FixtureUser, taskId: number, extra: any = {}) =>
    post(u, '/task-flags', { taskId, kind: 'blocker', reason: 'Waiting on the client test accounts', blockingOwnerExternal: 'Client IT', ...extra });
  const fileTicket = (taskId: number, extra: any = {}) =>
    post(f.users.devA, '/task-dependency-tickets', { parentTaskId: taskId, title: 'API keys', description: 'Need keys', ownerUserId: f.users.devNone.id, ...extra });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_flags, task_dependency_tickets, audit_logs, user_notifications RESTART IDENTITY CASCADE`);
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

  it('the clearing status list in the migration matches the code', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-10-performance-tracking-flags.sql'), 'utf8');
    const list = sql.match(/NEW\."status" IN \(([^)]*)\)/)![1];
    expect(list.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual(FLAG_CLEARING_STATUSES);
  });

  it('a dependency is overdue from 00:00 the next day in the team time zone', () => {
    // Africa/Addis_Ababa is UTC+3.
    expect(needByOverdueAt('2026-12-01', 'Africa/Addis_Ababa').toISOString()).toBe('2026-12-01T21:00:00.000Z');
  });

  describe('switch OFF - nothing changes', () => {
    beforeAll(() => setTracking(f.projects.pA, false));

    it('no flags, and a dependency has no needed-by date', async () => {
      const id = await newTask('Off task');
      expect((await get(f.users.devA, `/task-flags?taskId=${id}`).expect(200)).body).toMatchObject({ trackingOn: false, canSetRisk: false, canSetBlocker: false });
      await risk(f.users.devA, id).expect(400);
      await fileTicket(id, { needByDate: '2026-12-01' }).expect(400);
      const ticket = (await fileTicket(id).expect(201)).body;
      expect(ticket.needByDate).toBeNull();
      await patch(f.users.devA, `/task-dependency-tickets/${ticket.id}/need-by`, { needByDate: '2026-12-01', reason: 'Client asked for it' }).expect(400);
    });
  });

  describe('switch ON', () => {
    beforeAll(() => setTracking(f.projects.pA, true));

    it('the assignee raises a risk: reason required, date automatic, likely date for information only', async () => {
      const id = await newTask('Risk task');
      await risk(f.users.devA, id, { reason: 'short' }).expect(400);
      const state = (await risk(f.users.devA, id, { likelyDueDate: '2026-12-15' }).expect(201)).body;
      expect(state.risk).toMatchObject({ kind: 'risk', setByAssignee: true, likelyDueDate: '2026-12-15', committedDueDateAtSet: '2026-12-10', canClear: true });
      expect(state.risk.setAt).toBeTruthy();
      expect(state).toMatchObject({ canSetRisk: false, canSetBlocker: true });
      // The committed Due date is untouched.
      expect((await ds.query(`SELECT "dueDate"::text FROM project_tasks WHERE id = $1`, [id]))[0].dueDate).toBe('2026-12-10');
      // One open risk at a time.
      await risk(f.users.pm, id).expect(400);
      // A risk has no owner.
      await risk(f.users.devA, await newTask('Risk owner task'), { blockingOwnerExternal: 'Client' }).expect(400);
      expect(await audits('ProjectTask', id, TASK_FLAG_AUDIT.SET)).toHaveLength(1);
      expect(await notified(f.users.pm.id, 'task.riskSet', id)).toBe(true);
    });

    it('a PM-set flag is recorded as not set by the assignee', async () => {
      const id = await newTask('PM risk task');
      await risk(f.users.pm, id).expect(201);
      const [row] = await flagsOf(id);
      expect(row).toMatchObject({ setByUserId: f.users.pm.id, setByAssignee: false, assigneeUserId: f.users.devA.id });
      // Admin can too.
      await blocker(f.users.admin, id).expect(201);
      expect((await flagsOf(id))[1]).toMatchObject({ setByUserId: f.users.admin.id, setByAssignee: false });
    });

    it('a blocker needs exactly one owner: a tracker user, or an external party marked external', async () => {
      const id = await newTask('Blocker task');
      await post(f.users.devA, '/task-flags', { taskId: id, kind: 'blocker', reason: 'Waiting on the client test accounts' }).expect(400);
      await blocker(f.users.devA, id, { blockingOwnerUserId: f.users.devNone.id }).expect(400); // both
      await blocker(f.users.devA, id, { blockingOwnerExternal: undefined, blockingOwnerUserId: f.users.devA.id }).expect(400); // self
      await blocker(f.users.devA, id, { blockingOwnerExternal: undefined, blockingOwnerUserId: f.users.clientA.id }).expect(404);
      await blocker(f.users.devA, id, { likelyDueDate: '2026-12-15' }).expect(400);
      const state = (await blocker(f.users.devA, id, { blockingOwnerExternal: undefined, blockingOwnerUserId: f.users.devNone.id }).expect(201)).body;
      expect(state.blocker).toMatchObject({ external: false, blockingOwnerUserId: f.users.devNone.id, setByAssignee: true });
      expect(await notified(f.users.devNone.id, 'task.blockerSet', id)).toBe(true);
      expect(await notified(f.users.pm.id, 'task.blockerSet', id)).toBe(true);

      const ext = await newTask('External blocker task');
      await blocker(f.users.devA, ext).expect(201);
      expect((await flagsOf(ext))[0]).toMatchObject({ external: true, blockingOwnerExternal: 'Client IT', blockingOwnerUserId: null });
    });

    it('a blocker can link one of the task\'s open dependency tickets', async () => {
      const id = await newTask('Linked blocker task');
      const other = await newTask('Other task');
      const ticket = (await fileTicket(id, { needByDate: '2026-12-01' }).expect(201)).body;
      const otherTicket = (await fileTicket(other, { needByDate: '2026-12-01' }).expect(201)).body;
      await blocker(f.users.devA, id, { dependencyTicketId: otherTicket.id }).expect(400);
      await blocker(f.users.devA, id, { blockingOwnerExternal: undefined, blockingOwnerUserId: f.users.devNone.id, dependencyTicketId: ticket.id }).expect(201);
      expect((await flagsOf(id))[0]).toMatchObject({ dependencyTicketId: ticket.id });
      // Filing a ticket never sets a blocker on its own.
      expect(await flagsOf(other)).toHaveLength(0);
    });

    it('clearing: setter, assignee, PM/Admin, and the blocking owner - nobody else', async () => {
      const id = await newTask('Clear task');
      await blocker(f.users.pm, id, { blockingOwnerExternal: undefined, blockingOwnerUserId: f.users.devNone.id }).expect(201);
      const [flag] = await flagsOf(id);
      await patch(f.users.qaB, `/task-flags/${flag.id}/clear`).expect(403);
      // The blocking owner can see the flag through the clear call only if
      // they can view the task - devNone owns no ticket here, so 403.
      await patch(f.users.devNone, `/task-flags/${flag.id}/clear`).expect(403);
      await patch(f.users.devA, `/task-flags/${flag.id}/clear`, { note: 'Accounts arrived' }).expect(200);
      expect((await flagsOf(id))[0]).toMatchObject({ clearedByUserId: f.users.devA.id, clearNote: 'Accounts arrived', clearReason: 'manual' });
      await patch(f.users.devA, `/task-flags/${flag.id}/clear`).expect(400);
      expect(await audits('ProjectTask', id, TASK_FLAG_AUDIT.CLEARED)).toHaveLength(1);
      // A new one can go up after.
      await risk(f.users.devA, id).expect(201);
    });

    it('the blocking owner can clear when they can see the task', async () => {
      const id = await newTask('Owner clear task');
      // Owning a dependency ticket on the task gives devNone view access.
      const ticket = (await fileTicket(id, { needByDate: '2026-12-01' }).expect(201)).body;
      await blocker(f.users.devA, id, { blockingOwnerExternal: undefined, blockingOwnerUserId: f.users.devNone.id, dependencyTicketId: ticket.id }).expect(201);
      const [flag] = await flagsOf(id);
      expect((await get(f.users.devNone, `/task-flags?taskId=${id}`).expect(200)).body.blocker).toMatchObject({ canClear: true });
      await patch(f.users.devNone, `/task-flags/${flag.id}/clear`).expect(200);
    });

    it('only the assignee or a PM/Admin set flags; others cannot see them', async () => {
      const id = await newTask('Private flag task');
      await risk(f.users.devNone, id).expect(403);
      await risk(f.users.exec, id).expect(403);
      await get(f.users.devNone, `/task-flags?taskId=${id}`).expect(403);
    });

    it('Pass, Junk, Closed and Released clear open flags; Hold keeps them', async () => {
      const held = await newTask('Hold flag task');
      await risk(f.users.devA, held).expect(201);
      await patch(f.users.pm, `/tasks/${held}/hold`).expect(200);
      expect((await flagsOf(held))[0].clearedAt).toBeNull();

      const closed = await newTask('Close flag task');
      await risk(f.users.devA, closed).expect(201);
      await blocker(f.users.devA, closed).expect(201);
      await patch(f.users.pm, `/tasks/${closed}/close`).expect(200);
      const rows = await flagsOf(closed);
      expect(rows.map((r: any) => r.clearReason)).toEqual(['status:Closed', 'status:Closed']);
      expect(rows.every((r: any) => r.clearedAt)).toBe(true);
      // No new flags on a closed task.
      await risk(f.users.pm, closed).expect(400);
    });

    it('Team Tasks badges: open flags in tracked projects, leadership only', async () => {
      const id = await newTask('Badge task');
      await blocker(f.users.devA, id).expect(201);
      const body = (await get(f.users.pm, `/task-flags/open?taskIds=${id},999999`).expect(200)).body;
      expect(body.items).toEqual([expect.objectContaining({ taskId: id, kind: 'blocker', external: true })]);
      await get(f.users.devA, `/task-flags/open?taskIds=${id}`).expect(403);
      await get(f.users.pm, '/task-flags/open?taskIds=abc').expect(400);
      // Switching the project off hides them.
      await setTracking(f.projects.pA, false);
      expect((await get(f.users.exec, `/task-flags/open?taskIds=${id}`).expect(200)).body.items).toEqual([]);
      await setTracking(f.projects.pA, true);
    });

    describe('dependency needed-by date', () => {
      it('is required when filing, cannot be in the past, and sets overdueAt', async () => {
        const id = await newTask('Need-by task');
        await fileTicket(id).expect(400);
        await fileTicket(id, { needByDate: '2020-01-01' }).expect(400);
        const ticket = (await fileTicket(id, { needByDate: '2026-12-01' }).expect(201)).body;
        expect(ticket.needByDate).toBe('2026-12-01');
        expect(new Date(ticket.overdueAt).toISOString()).toBe('2026-12-01T21:00:00.000Z');
      });

      it('the creator or a PM/Admin change it with a reason, logged; the owner cannot', async () => {
        const id = await newTask('Need-by change task');
        const ticket = (await fileTicket(id, { needByDate: '2026-12-01' }).expect(201)).body;
        const url = `/task-dependency-tickets/${ticket.id}/need-by`;
        await patch(f.users.devNone, url, { needByDate: '2026-12-20', reason: 'I need more time on it' }).expect(403);
        await patch(f.users.devA, url, { needByDate: '2026-12-05', reason: 'short' }).expect(400);
        await patch(f.users.devA, url, { needByDate: '2026-12-01', reason: 'Same date as before here' }).expect(400);
        const updated = (await patch(f.users.devA, url, { needByDate: '2026-12-05', reason: 'Release slipped by the client' }).expect(200)).body;
        expect(updated.needByDate).toBe('2026-12-05');
        expect(new Date(updated.overdueAt).toISOString()).toBe('2026-12-05T21:00:00.000Z');
        await patch(f.users.pm, url, { needByDate: '2026-12-03', reason: 'Agreed with the owner on the call' }).expect(200);
        const logged = await audits('TaskDependencyTicket', ticket.id, TASK_FLAG_AUDIT.DEPENDENCY_NEED_BY_CHANGED);
        expect(logged).toHaveLength(2);
        expect(logged[0].details).toContain('"previousNeedByDate":"2026-12-01"');
        // It shows in the task's dependency history.
        const history = (await get(f.users.devA, `/task-dependency-tickets/history?parentTaskId=${id}`).expect(200)).body;
        expect(history.filter((h: any) => h.action === TASK_FLAG_AUDIT.DEPENDENCY_NEED_BY_CHANGED).map((h: any) => h.needByDate)).toEqual(['2026-12-05', '2026-12-03']);
        // Not once resolved.
        await patch(f.users.devNone, `/task-dependency-tickets/${ticket.id}/resolve`).expect(200);
        await patch(f.users.pm, url, { needByDate: '2026-12-09', reason: 'Too late, it is resolved' }).expect(400);
      });

      it('an older undated ticket can be dated by its creator, with a reason', async () => {
        const id = await newTask('Undated task');
        await setTracking(f.projects.pA, false);
        const ticket = (await fileTicket(id).expect(201)).body;
        await setTracking(f.projects.pA, true);
        expect(ticket.needByDate).toBeNull();
        await patch(f.users.devA, `/task-dependency-tickets/${ticket.id}/need-by`, { needByDate: '2026-12-02', reason: 'Dating an older dependency' }).expect(200);
      });
    });
  });
});
