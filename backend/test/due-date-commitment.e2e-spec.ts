import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { AuditActions } from '../src/audit/audit-log.service';
import { DUE_DATE_AUDIT, DUE_DATE_FROZEN_STATUSES } from '../src/tasks/due-date-change';

// Performance Tracking S2 (2026-10-28): the committed Due date and change
// requests. OFF = today's rules. ON = the assignee's first date locks; a
// change is a request (reason) that any PM/Admin approves or rejects (note);
// the old date stays until approved; an earlier date needs approval too;
// PM/Admin may change it directly with a reason; reassignment keeps the
// date and gives the new assignee one free set or confirmation; a pending
// request is cancelled by reassignment or Pass/Junk/Hold/Closed/Released.
describe('Due date commitment (Performance Tracking S2, e2e)', () => {
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
  const taskRow = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];
  const toDate = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const dueOf = async (id: number) => {
    const d = (await taskRow(id)).dueDate;
    return d == null ? null : toDate(d);
  };
  const audits = (id: number, action: string) =>
    ds.query(`SELECT * FROM audit_logs WHERE "entityType" = 'ProjectTask' AND "entityId" = $1 AND action = $2 ORDER BY id`, [id, action]);
  const requests = (taskId: number) => ds.query(`SELECT * FROM due_date_change_requests WHERE "taskId" = $1 ORDER BY id`, [taskId]);
  const notified = async (userId: number, type: string, taskId: number) => {
    for (let i = 0; i < 40; i++) {
      const rows = await ds.query(`SELECT 1 FROM user_notifications WHERE "userId" = $1 AND type = $2 AND link = $3`, [userId, type, `/tasks/${taskId}#due-date`]);
      if (rows.length) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const setTracking = (projectId: number, enabled: boolean) => patch(f.users.pm, `/performance-tracking/projects/${projectId}`, { enabled }).expect(200);
  const newTask = async (title: string, assignee: FixtureUser | null = f.users.devA) =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', $5, 'x', 'Development', $6, $7, $8, $9) RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, title, assignee?.id ?? null, assignee?.email ?? null, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;
  // A task the developer has committed to 2026-11-10.
  const committedTask = async (title: string) => {
    const id = await newTask(title);
    await patch(f.users.devA, `/tasks/${id}`, { dueDate: '2026-11-10' }).expect(200);
    return id;
  };
  const ask = (id: number, dueDate = '2026-11-14', reason = 'Waiting on the payment API sandbox', u = f.users.devA) =>
    post(u, `/tasks/${id}/due-date-changes`, { dueDate, reason });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, audit_logs, task_commitment_events, due_date_change_requests, user_notifications RESTART IDENTITY CASCADE`);
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

  it('the frozen status list in the migration matches the code', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-10-performance-tracking-due-date-commitment.sql'), 'utf8');
    const list = sql.match(/NEW\."status" IN \(([^)]*)\)/)![1];
    expect(list.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual(DUE_DATE_FROZEN_STATUSES);
  });

  describe('switch OFF - today\'s rules', () => {
    beforeAll(() => setTracking(f.projects.pA, false));

    it('the first date locks for the assignee, PM edits freely without a reason, no requests', async () => {
      const id = await committedTask('Off task');
      expect((await taskRow(id)).dueDateCommittedByUserId).toBe(f.users.devA.id);
      await patch(f.users.devA, `/tasks/${id}`, { dueDate: '2026-11-12' }).expect(403);
      await patch(f.users.pm, `/tasks/${id}`, { dueDate: '2026-11-12' }).expect(200);
      expect(await dueOf(id)).toBe('2026-11-12');
      await ask(id).expect(400);
      await post(f.users.pm, `/tasks/${id}/due-date-changes`, { dueDate: '2026-11-20', reason: 'Client moved the release' }).expect(400);
      const state = (await get(f.users.devA, `/tasks/${id}/due-date`).expect(200)).body;
      expect(state).toMatchObject({ trackingOn: false, canRequest: false, canCommit: false, canChangeDirect: false });
    });
  });

  describe('switch ON', () => {
    beforeAll(() => setTracking(f.projects.pA, true));

    it('the first date the assignee sets is the commitment and locks', async () => {
      const id = await committedTask('Commit task');
      const state = (await get(f.users.devA, `/tasks/${id}/due-date`).expect(200)).body;
      expect(state).toMatchObject({ trackingOn: true, state: 'committed', committedByUserId: f.users.devA.id, canRequest: true, canCommit: false });
      await patch(f.users.devA, `/tasks/${id}`, { dueDate: '2026-11-12' }).expect(403);
    });

    it('PM cannot change a set date on the form without a reason; can with Change date', async () => {
      const id = await committedTask('PM direct task');
      await patch(f.users.pm, `/tasks/${id}`, { dueDate: '2026-11-12' }).expect(400);
      // Re-saving the same date is not a change.
      await patch(f.users.pm, `/tasks/${id}`, { dueDate: '2026-11-10' }).expect(200);
      await post(f.users.pm, `/tasks/${id}/due-date-changes`, { dueDate: '2026-11-12', reason: 'short' }).expect(400);
      await post(f.users.pm, `/tasks/${id}/due-date-changes`, { dueDate: '2026-11-12', reason: 'Client moved the release by two days' }).expect(201);
      expect(await dueOf(id)).toBe('2026-11-12');
      const [row] = await requests(id);
      expect(row).toMatchObject({ kind: 'direct', status: 'approved', requestedByUserId: f.users.pm.id, decidedByUserId: f.users.pm.id });
      expect(row.auditLogId).toBeTruthy();
      // The change is in the commitment history, linked to its request.
      const [ev] = await ds.query(`SELECT * FROM task_commitment_events WHERE "auditLogId" = $1`, [row.auditLogId]);
      expect(ev).toMatchObject({ kind: 'due_changed', direction: 'later', actorUserId: f.users.pm.id, assigneeUserId: f.users.devA.id });
      expect(await audits(id, AuditActions.TASK_DUE_DATE_EDITED)).toHaveLength(1);
      expect(await audits(id, DUE_DATE_AUDIT.CHANGED_DIRECT)).toHaveLength(1);
      expect(await notified(f.users.devA.id, 'task.dueDateProposed', id)).toBe(true);
      // A PM's date is a PROPOSAL until the developer confirms it (2026-10-28).
      expect((await taskRow(id)).dueDateCommittedByUserId).toBeNull();
      const state = (await get(f.users.devA, `/tasks/${id}/due-date`).expect(200)).body;
      expect(state).toMatchObject({ state: 'needs_commitment', canCommit: true, proposedByName: expect.any(String) });
    });

    it('Admin can change it directly too (Admin cannot edit the task form)', async () => {
      const id = await committedTask('Admin direct task');
      await post(f.users.admin, `/tasks/${id}/due-date-changes`, { dueDate: '2026-11-08', reason: 'Release brought forward by the client' }).expect(201);
      expect(await dueOf(id)).toBe('2026-11-08');
    });

    it('the assignee asks; the old date stays until a PM approves; history and notifications', async () => {
      const id = await committedTask('Request task');
      await ask(id, '2026-11-14', 'too short').expect(400);
      await ask(id, '2026-11-10').expect(400); // same date
      await ask(id).expect(201);
      expect(await dueOf(id)).toBe('2026-11-10');
      await ask(id, '2026-11-15').expect(400); // one pending at a time
      expect(await notified(f.users.pm.id, 'task.dueDateChangeRequested', id)).toBe(true);
      expect(await notified(f.users.admin.id, 'task.dueDateChangeRequested', id)).toBe(true);

      const queue = (await get(f.users.pm, '/tasks/due-date-changes').expect(200)).body.items;
      const item = queue.find((r: any) => r.taskId === id);
      expect(item).toMatchObject({ currentDueDate: '2026-11-10', requestedDueDate: '2026-11-14', direction: 'later', reason: 'Waiting on the payment API sandbox' });
      await get(f.users.devA, '/tasks/due-date-changes').expect(403);
      await get(f.users.exec, '/tasks/due-date-changes').expect(403);

      const pmState = (await get(f.users.pm, `/tasks/${id}/due-date`).expect(200)).body;
      expect(pmState).toMatchObject({ canDecide: true });
      // Only PM/Admin decide.
      await patch(f.users.devA, `/tasks/due-date-changes/${item.id}/approve`).expect(403);
      await patch(f.users.exec, `/tasks/due-date-changes/${item.id}/approve`).expect(403);

      await patch(f.users.pm, `/tasks/due-date-changes/${item.id}/approve`, { note: 'OK' }).expect(200);
      expect(await dueOf(id)).toBe('2026-11-14');
      const [row] = await requests(id);
      expect(row).toMatchObject({ status: 'approved', decidedByUserId: f.users.pm.id, decisionNote: 'OK' });
      const [ev] = await ds.query(`SELECT kind, "oldDueDate"::text, "newDueDate"::text FROM task_commitment_events WHERE "auditLogId" = $1`, [row.auditLogId]);
      expect(ev).toMatchObject({ kind: 'due_changed', oldDueDate: '2026-11-10', newDueDate: '2026-11-14' });
      expect(await notified(f.users.devA.id, 'task.dueDateChangeDecided', id)).toBe(true);
      // Approving twice fails.
      await patch(f.users.pm, `/tasks/due-date-changes/${item.id}/approve`).expect(400);

      const devState = (await get(f.users.devA, `/tasks/${id}/due-date`).expect(200)).body;
      expect(devState.requests).toHaveLength(1);
      expect(devState.events.map((e: any) => e.kind)).toEqual(['due_changed', 'due_set']);
    });

    it('an earlier date needs approval too; a rejection needs a note and keeps the date', async () => {
      const id = await committedTask('Reject task');
      await ask(id, '2026-11-05', 'Can finish early, the API is ready').expect(201);
      expect(await dueOf(id)).toBe('2026-11-10');
      const [req] = await requests(id);
      await patch(f.users.admin, `/tasks/due-date-changes/${req.id}/reject`, {}).expect(400);
      await patch(f.users.admin, `/tasks/due-date-changes/${req.id}/reject`, { note: 'Keep the buffer for QA' }).expect(200);
      expect(await dueOf(id)).toBe('2026-11-10');
      expect((await requests(id))[0]).toMatchObject({ status: 'rejected', decidedByUserId: f.users.admin.id, decisionNote: 'Keep the buffer for QA' });
      expect(await audits(id, DUE_DATE_AUDIT.REJECTED)).toHaveLength(1);
      expect(await notified(f.users.devA.id, 'task.dueDateChangeDecided', id)).toBe(true);
    });

    it('the requester can withdraw; nobody else can', async () => {
      const id = await committedTask('Withdraw task');
      await ask(id).expect(201);
      const [req] = await requests(id);
      await patch(f.users.pm, `/tasks/due-date-changes/${req.id}/withdraw`).expect(403);
      await patch(f.users.devA, `/tasks/due-date-changes/${req.id}/withdraw`).expect(200);
      expect((await requests(id))[0].status).toBe('withdrawn');
      // Free to ask again.
      await ask(id).expect(201);
    });

    it('a PM who is the assignee must ask; another PM/Admin decides, never themselves', async () => {
      const id = await newTask('PM own task', f.users.pm);
      await patch(f.users.pm, `/tasks/${id}`, { dueDate: '2026-11-10' }).expect(200);
      const state = (await get(f.users.pm, `/tasks/${id}/due-date`).expect(200)).body;
      expect(state).toMatchObject({ state: 'committed', canRequest: true, canChangeDirect: false });
      // Their change becomes a pending request - the date stays.
      await ask(id, '2026-11-14', 'Waiting on the payment API sandbox', f.users.pm).expect(201);
      expect(await dueOf(id)).toBe('2026-11-10');
      const [row] = await requests(id);
      expect(row).toMatchObject({ kind: 'request', status: 'pending', requestedByUserId: f.users.pm.id });
      expect((await get(f.users.pm, `/tasks/${id}/due-date`).expect(200)).body).toMatchObject({ canDecide: false, canWithdraw: true });
      const own = (await get(f.users.pm, '/tasks/due-date-changes').expect(200)).body.items.find((r: any) => r.taskId === id);
      expect(own).toMatchObject({ own: true });
      // Cannot approve or reject it themselves.
      await patch(f.users.pm, `/tasks/due-date-changes/${row.id}/approve`, { note: 'OK' }).expect(403);
      await patch(f.users.pm, `/tasks/due-date-changes/${row.id}/reject`, { note: 'Not this time, sorry' }).expect(403);
      expect(await dueOf(id)).toBe('2026-11-10');
      // Another decider can.
      expect((await get(f.users.admin, `/tasks/${id}/due-date`).expect(200)).body).toMatchObject({ canDecide: true, canChangeDirect: true });
      await patch(f.users.admin, `/tasks/due-date-changes/${row.id}/approve`, { note: 'OK' }).expect(200);
      expect(await dueOf(id)).toBe('2026-11-14');
      expect((await requests(id))[0]).toMatchObject({ status: 'approved', decidedByUserId: f.users.admin.id });
    });

    it('an Admin who is the assignee must ask too', async () => {
      const id = await newTask('Admin own task', f.users.admin);
      await ds.query(`UPDATE project_tasks SET "dueDate" = '2026-11-10', "dueDateCommittedByUserId" = $2 WHERE id = $1`, [id, f.users.admin.id]);
      await post(f.users.admin, `/tasks/${id}/due-date-changes`, { dueDate: '2026-11-12', reason: 'Client moved the release by two days' }).expect(201);
      expect(await dueOf(id)).toBe('2026-11-10');
      const [row] = await requests(id);
      expect(row).toMatchObject({ kind: 'request', status: 'pending' });
      await patch(f.users.admin, `/tasks/due-date-changes/${row.id}/approve`).expect(403);
      await patch(f.users.pm, `/tasks/due-date-changes/${row.id}/reject`, { note: 'Keep the original date please' }).expect(200);
      expect(await dueOf(id)).toBe('2026-11-10');
    });

    it('someone made PM after asking cannot decide their own request', async () => {
      const id = await committedTask('Promoted task');
      await ask(id).expect(201);
      const [row] = await requests(id);
      // Simulate the developer's request being decided by the same user id
      // after a role change: hand the request to the PM as its requester.
      await ds.query(`UPDATE due_date_change_requests SET "requestedByUserId" = $2 WHERE id = $1`, [row.id, f.users.pm.id]);
      await patch(f.users.pm, `/tasks/due-date-changes/${row.id}/approve`, { note: 'OK' }).expect(403);
      await patch(f.users.pm, `/tasks/due-date-changes/${row.id}/reject`, { note: 'Not this time, sorry' }).expect(403);
      await patch(f.users.admin, `/tasks/due-date-changes/${row.id}/approve`, { note: 'OK' }).expect(200);
      expect(await dueOf(id)).toBe('2026-11-14');
    });

    it('a PM direct change supersedes a pending request', async () => {
      const id = await committedTask('Supersede task');
      await ask(id).expect(201);
      await post(f.users.pm, `/tasks/${id}/due-date-changes`, { dueDate: '2026-11-20', reason: 'Agreed on the call: the 20th' }).expect(201);
      const rows = await requests(id);
      expect(rows.map((r: any) => [r.kind, r.status, r.cancelReason])).toEqual([
        ['request', 'cancelled', 'superseded'],
        ['direct', 'approved', null],
      ]);
      expect(await dueOf(id)).toBe('2026-11-20');
    });

    it('reassignment keeps the date, cancels the pending request, and gives the new assignee one free change', async () => {
      const id = await committedTask('Reassign task');
      await ask(id).expect(201);
      await patch(f.users.pm, `/tasks/${id}/reassign`, { assigneeUserId: f.users.devNone.id }).expect(200);
      expect(await dueOf(id)).toBe('2026-11-10');
      expect((await requests(id))[0]).toMatchObject({ status: 'cancelled', cancelReason: 'reassigned' });

      const state = (await get(f.users.devNone, `/tasks/${id}/due-date`).expect(200)).body;
      expect(state).toMatchObject({ state: 'needs_commitment', canCommit: true, canRequest: false });
      // The form stays locked; the card is the way.
      await patch(f.users.devNone, `/tasks/${id}`, { dueDate: '2026-11-18' }).expect(403);
      await ask(id, '2026-11-18', 'Need time to get up to speed', f.users.devNone).expect(400);
      await post(f.users.devA, `/tasks/${id}/due-date/commit`, { dueDate: '2026-11-18' }).expect(403);
      await post(f.users.devNone, `/tasks/${id}/due-date/commit`, { dueDate: '2026-11-18' }).expect(201);
      expect(await dueOf(id)).toBe('2026-11-18');
      expect((await taskRow(id)).dueDateCommittedByUserId).toBe(f.users.devNone.id);
      // Only once.
      await post(f.users.devNone, `/tasks/${id}/due-date/commit`, { dueDate: '2026-11-19' }).expect(400);
      expect((await get(f.users.devNone, `/tasks/${id}/due-date`).expect(200)).body).toMatchObject({ state: 'committed', canRequest: true });
      // Their own date is a commitment in the date-history log, not a change.
      const [ev] = await ds.query(`SELECT kind, "actorUserId", "oldDueDate"::text, "newDueDate"::text FROM task_commitment_events WHERE "taskId" = $1 ORDER BY id DESC LIMIT 1`, [id]);
      expect(ev).toMatchObject({ kind: 'due_committed', actorUserId: f.users.devNone.id, oldDueDate: '2026-11-10', newDueDate: '2026-11-18' });
    });

    it('a new assignee can also confirm the same date', async () => {
      const id = await committedTask('Confirm task');
      await patch(f.users.pm, `/tasks/${id}/reassign`, { assigneeUserId: f.users.devNone.id }).expect(200);
      await post(f.users.devNone, `/tasks/${id}/due-date/commit`, { dueDate: '2026-11-10' }).expect(201);
      expect(await dueOf(id)).toBe('2026-11-10');
      expect((await taskRow(id)).dueDateCommittedByUserId).toBe(f.users.devNone.id);
      expect((await audits(id, DUE_DATE_AUDIT.COMMITTED))[0].details).toContain('"confirmed":true');
    });

    it('a date the PM set is not the assignee\'s commitment until they confirm it', async () => {
      const id = await newTask('PM-set task');
      await patch(f.users.pm, `/tasks/${id}`, { dueDate: '2026-11-11' }).expect(200);
      expect((await get(f.users.devA, `/tasks/${id}/due-date`).expect(200)).body).toMatchObject({ state: 'needs_commitment', canCommit: true });
    });

    describe('proposed dates (2026-10-28)', () => {
      it('a Confirm is a due_committed event (who, when, which date) and locks the date', async () => {
        const id = await committedTask('Confirm event task');
        await patch(f.users.pm, `/tasks/${id}/reassign`, { assigneeUserId: f.users.devNone.id }).expect(200);
        await post(f.users.devNone, `/tasks/${id}/due-date/commit`, { dueDate: '2026-11-10' }).expect(201);
        const [ev] = await ds.query(`SELECT * FROM task_commitment_events WHERE "taskId" = $1 AND kind = 'due_committed'`, [id]);
        expect(ev).toMatchObject({ actorUserId: f.users.devNone.id, assigneeUserId: f.users.devNone.id, source: 'live' });
        expect([toDate(ev.oldDueDate), toDate(ev.newDueDate)]).toEqual(['2026-11-10', '2026-11-10']);
        expect(ev.auditLogId).toBe((await audits(id, DUE_DATE_AUDIT.COMMITTED))[0].id);
      });

      it('PM and Admin propose a first date from the card; the assignee is told; then confirms', async () => {
        for (const proposer of [f.users.pm, f.users.admin]) {
          const id = await newTask(`Propose task ${proposer.role}`);
          expect((await get(proposer, `/tasks/${id}/due-date`).expect(200)).body).toMatchObject({ canPropose: true });
          await post(f.users.devA, `/tasks/${id}/due-date/propose`, { dueDate: '2026-11-21' }).expect(403);
          await post(proposer, `/tasks/${id}/due-date/propose`, { dueDate: '2026-11-21' }).expect(201);
          expect(await dueOf(id)).toBe('2026-11-21');
          expect((await taskRow(id)).dueDateCommittedByUserId).toBeNull();
          expect(await audits(id, DUE_DATE_AUDIT.PROPOSED)).toHaveLength(1);
          expect(await notified(f.users.devA.id, 'task.dueDateProposed', id)).toBe(true);
          // Only a first date - after that it is Change date.
          await post(proposer, `/tasks/${id}/due-date/propose`, { dueDate: '2026-11-22' }).expect(400);
          await post(f.users.devA, `/tasks/${id}/due-date/commit`, { dueDate: '2026-11-21' }).expect(201);
          expect((await taskRow(id)).dueDateCommittedByUserId).toBe(f.users.devA.id);
        }
      });

      it('a PM first date on the form is a proposal too, and the assignee is told', async () => {
        const id = await newTask('Form proposal task');
        await patch(f.users.pm, `/tasks/${id}`, { dueDate: '2026-11-23' }).expect(200);
        expect((await taskRow(id)).dueDateCommittedByUserId).toBeNull();
        expect(await notified(f.users.devA.id, 'task.dueDateProposed', id)).toBe(true);
      });

      it('an approved request stays the developer\'s commitment', async () => {
        const id = await committedTask('Approved stays task');
        await ask(id).expect(201);
        const [req] = await requests(id);
        await patch(f.users.pm, `/tasks/due-date-changes/${req.id}/approve`).expect(200);
        expect((await taskRow(id)).dueDateCommittedByUserId).toBe(f.users.devA.id);
      });

      it('the backfill script rebuilds exactly the live events, due_committed included', async () => {
        const BACKFILL = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-10-performance-metrics-backfill.sql'), 'utf8');
        const q = `SELECT "tenantId", "taskId", kind, "assigneeUserId", "previousAssigneeUserId", "actorUserId", "actorRole", "occurredAt",
                          "oldDueDate"::text, "newDueDate"::text, direction, "auditLogId" FROM task_commitment_events ORDER BY "auditLogId"`;
        const live = await ds.query(q);
        expect(live.filter((e: any) => e.kind === 'due_committed').length).toBeGreaterThan(1);
        await ds.query(`DELETE FROM task_commitment_events`);
        await ds.query(BACKFILL);
        expect(await ds.query(q)).toEqual(live);
      });

      it('Date set on time: judged on the assignee\'s confirm time; never confirming is not on time', async () => {
        const confirmed = await newTask('On-time confirmed task');
        await post(f.users.pm, `/tasks/${confirmed}/due-date/propose`, { dueDate: '2026-11-24' }).expect(201);
        await post(f.users.devA, `/tasks/${confirmed}/due-date/commit`, { dueDate: '2026-11-24' }).expect(201);
        const never = await newTask('Never confirmed task');
        await post(f.users.pm, `/tasks/${never}/due-date/propose`, { dueDate: '2026-11-24' }).expect(201);
        // Back-date both: assigned 6 days ago, proposed right after; the
        // first confirmed an hour later. Tracking on since 7 days ago.
        await ds.query(`UPDATE project_tasks SET "createdAt" = now() - interval '6 days' WHERE id = ANY($1)`, [[confirmed, never]]);
        await ds.query(`UPDATE task_commitment_events SET "occurredAt" = now() - interval '6 days' + interval '1 minute' WHERE "taskId" = ANY($1) AND kind = 'due_set'`, [[confirmed, never]]);
        await ds.query(`UPDATE task_commitment_events SET "occurredAt" = now() - interval '6 days' + interval '1 hour' WHERE "taskId" = $1 AND kind = 'due_committed'`, [confirmed]);
        await ds.query(`UPDATE projects SET "performanceTrackingSince" = now() - interval '7 days' WHERE id = $1`, [f.projects.pA]);
        const body = (await get(f.users.pm, `/performance-metrics?to=${new Date().toISOString().slice(0, 10)}`).expect(200)).body;
        const items = body.people.find((p: any) => p.userId === f.users.devA.id).onTime.items;
        expect(items.find((i: any) => i.taskId === confirmed)).toMatchObject({ outcome: 'on_time', setByUserId: f.users.devA.id });
        expect(items.find((i: any) => i.taskId === never)).toMatchObject({ outcome: 'not_confirmed', setAt: null });
      });
    });

    it('Hold cancels a pending request and freezes the date', async () => {
      const id = await committedTask('Hold task');
      await ask(id).expect(201);
      await patch(f.users.pm, `/tasks/${id}/hold`).expect(200);
      expect((await requests(id))[0]).toMatchObject({ status: 'cancelled', cancelReason: 'status:Hold' });
      await post(f.users.pm, `/tasks/${id}/due-date-changes`, { dueDate: '2026-11-20', reason: 'Client moved the release' }).expect(400);
      expect((await get(f.users.pm, `/tasks/${id}/due-date`).expect(200)).body).toMatchObject({ frozen: true, canChangeDirect: false });
    });

    it('other people cannot see or act on the task', async () => {
      const id = await committedTask('Private task');
      await get(f.users.devNone, `/tasks/${id}/due-date`).expect(403);
      await ask(id, '2026-11-14', 'Waiting on the payment API sandbox', f.users.devNone).expect(403);
      await post(f.users.qaB, `/tasks/${id}/due-date-changes`, { dueDate: '2026-11-14', reason: 'Waiting on the payment API sandbox' }).expect(403);
    });

    it('Non-Compliance charges an approved request to the developer; a PM direct change and a free commitment are not charged', async () => {
      const asked = await committedTask('Metric request task');
      await ask(asked).expect(201);
      const [req] = await requests(asked);
      await patch(f.users.pm, `/tasks/due-date-changes/${req.id}/approve`, { note: 'OK' }).expect(200);
      const direct = await committedTask('Metric direct task');
      await post(f.users.pm, `/tasks/${direct}/due-date-changes`, { dueDate: '2026-11-12', reason: 'Client moved the release by two days' }).expect(201);
      const free = await committedTask('Metric free task');
      await patch(f.users.pm, `/tasks/${free}/reassign`, { assigneeUserId: f.users.devNone.id }).expect(200);
      await post(f.users.devNone, `/tasks/${free}/due-date/commit`, { dueDate: '2026-11-18' }).expect(201);

      const body = (await get(f.users.pm, `/performance-metrics?to=${new Date().toISOString().slice(0, 10)}`).expect(200)).body;
      const of = (u: FixtureUser) => body.people.find((p: any) => p.userId === u.id).dueChanges;
      const charged = of(f.users.devA).items.filter((i: any) => [asked, direct].includes(i.taskId));
      expect(charged).toEqual([expect.objectContaining({ taskId: asked, byUserId: f.users.pm.id, initiatedByUserId: f.users.devA.id })]);
      expect(of(f.users.devA).notCharged.items.filter((i: any) => i.taskId === direct)).toHaveLength(1);
      expect([...of(f.users.devNone).items, ...of(f.users.devNone).notCharged.items].filter((i: any) => i.taskId === free)).toHaveLength(0);
    });

    it('switching OFF again restores today\'s rules', async () => {
      const id = await committedTask('Back off task');
      await setTracking(f.projects.pA, false);
      await patch(f.users.pm, `/tasks/${id}`, { dueDate: '2026-11-12' }).expect(200);
      await setTracking(f.projects.pA, true);
    });
  });
});
