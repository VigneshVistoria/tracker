import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { computeScrumWindow } from '../src/daily-scrum/daily-scrum-window';

// Daily Scrum Stage 1 (2026-10-12): the endpoints, who may call them,
// that they never change anything, and the team settings.
describe('Daily Scrum (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  const ids: Record<string, number> = {};
  const PAST = '2020-01-06';
  const FUTURE = '2099-12-31';
  // Inside the window whatever day the tests run on: the window always
  // starts at 00:00 of the last working day, which is before now.
  const inside = () => new Date(Date.now() - 60 * 1000);
  const outside = () => new Date(computeScrumWindow(new Date(), 'Africa/Addis_Ababa').since.getTime() - 3600 * 1000);

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);

  const task = async (key: string, values: Record<string, any>) => {
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pA,
      projectName: 'Project A',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'Build',
      title: `Task ${key}`,
      description: 'x',
      status: 'Development',
      dueDate: FUTURE,
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
    ids[key] = res[0].id;
  };

  const round = (taskId: number, values: Record<string, any>) => {
    const row = {
      tenantId: f.tenants.t1,
      taskId,
      roundNumber: 1,
      resolution: 'done',
      submittedByUserId: f.users.devA.id,
      submittedByEmail: f.users.devA.email,
      status: 'pending',
      reviewType: 'qa',
      ...values,
    };
    const cols = Object.keys(row);
    return ds.query(
      `INSERT INTO task_qa_reviews (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    );
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_blocking_defects, audit_logs, test_executions, test_cases, team_settings, scrum_external_waits RESTART IDENTITY CASCADE`,
    );
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;

    // devA's tickets - one per group/reason.
    await task('today', {});
    await task('overdue', { dueDate: PAST });
    await task('failed', { status: 'Failed' });
    await task('escalated', { status: 'Escalated' });
    await task('waiting', {});
    await task('blocked', {});
    await task('inQaOverdue', { status: 'Feedback', dueDate: PAST });
    await task('inPeer', { status: 'Peer Review', peerReviewEnabled: true });
    // Never counted.
    await task('held', { status: 'Hold', priorStatus: 'Development', dueDate: PAST });
    await task('junk', { status: 'Junk', statusBeforeJunk: 'Development', dueDate: PAST });
    await task('passed', { status: 'Pass' });
    await task('closed', { status: 'Closed' });
    // devNone's own ticket: the open defect blocking devA's 'blocked'.
    await task('defect', {
      isDefect: true,
      parentTaskId: null,
      assigneeUserId: f.users.devNone.id,
      assigneeEmail: f.users.devNone.email,
      createdByUserId: f.users.qaB.id,
      createdByEmail: f.users.qaB.email,
    });
    await ds.query(`UPDATE project_tasks SET "parentTaskId" = $1 WHERE id = $2`, [ids.blocked, ids.defect]);

    // devNone owns the dependency on 'waiting' and one on the held task.
    for (const parent of [ids.waiting, ids.held]) {
      await ds.query(
        `INSERT INTO task_dependency_tickets ("tenantId", "parentTaskId", "title", "description", "ownerUserId", "ownerEmail", "createdByUserId", "createdByEmail", "status", "createdAt")
         VALUES ($1, $2, 'Need API', 'x', $3, $4, $5, $6, 'open', $7)`,
        [f.tenants.t1, parent, f.users.devNone.id, f.users.devNone.email, f.users.devA.id, f.users.devA.email, inside()],
      );
    }

    // Review rounds: devA submitted 'inQaOverdue' today; 'inPeer' is with
    // devNone; QA passed 'passed' inside the window; an old round outside.
    await round(ids.inQaOverdue, { submittedAt: inside() });
    await round(ids.inPeer, { reviewType: 'peer', reviewerUserId: f.users.devNone.id, reviewerEmail: f.users.devNone.email, submittedAt: inside() });
    await round(ids.passed, {
      status: 'approved',
      submittedAt: outside(),
      reviewedAt: inside(),
      reviewedByUserId: f.users.qaB.id,
      reviewedByEmail: f.users.qaB.email,
    });
    await round(ids.failed, {
      status: 'rejected',
      submittedAt: outside(),
      reviewedAt: outside(),
      reviewedByUserId: f.users.qaB.id,
      reviewedByEmail: f.users.qaB.email,
    });
    // A Junk ticket's activity never shows.
    await round(ids.junk, { submittedAt: inside() });

    await ds.query(
      `INSERT INTO audit_logs ("tenantId", "userId", "userEmail", "action", "entityType", "entityId", "details", "createdAt")
       VALUES ($1, $2, $3, 'task_assigned', 'ProjectTask', $4, $5, $6)`,
      [f.tenants.t1, f.users.pm.id, f.users.pm.email, ids.today, JSON.stringify({ assigneeUserId: f.users.devA.id }), inside()],
    );

    // qaB's test runs: 2 passed + 1 failed inside the window, 1 outside.
    const testCaseId = (
      await ds.query(
        `INSERT INTO test_cases ("tenantId", "caseNumber", "title", "steps", "expectedResult", "projectId", "projectName", "createdByUserId", "createdByEmail")
         VALUES ($1, 'TC-1', 'Login', 'Open the app', 'Logged in', $2, 'Project A', $3, $4) RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.users.qaB.id, f.users.qaB.email],
      )
    )[0].id;
    for (const [result, at] of [['Passed', inside()], ['Passed', inside()], ['Failed', inside()], ['Failed', outside()]] as const) {
      await ds.query(
        `INSERT INTO test_executions ("tenantId", "testCaseId", "result", "executedByUserId", "executedByEmail", "executedAt") VALUES ($1, $2, $3, $4, $5, $6)`,
        [f.tenants.t1, testCaseId, result, f.users.qaB.id, f.users.qaB.email, at],
      );
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const ENDPOINTS: Array<['get' | 'patch' | 'post', string]> = [
    ['get', '/daily-scrum/me'],
    ['get', '/daily-scrum/team'],
    ['get', '/daily-scrum/people/1'],
    ['get', '/daily-scrum/settings'],
    ['patch', '/daily-scrum/settings'],
    ['get', '/daily-scrum/external-waits'],
    ['post', '/daily-scrum/external-waits'],
    ['patch', '/daily-scrum/external-waits/1'],
  ];

  describe('who can call what', () => {
    it('401 without login, and with a bad token, on every endpoint', async () => {
      for (const [method, url] of ENDPOINTS) {
        await http()[method](url).expect(401);
        await http()[method](url).set({ Authorization: 'Bearer not-a-token' }).expect(401);
      }
    });

    it('403 for a Client user on every endpoint', async () => {
      for (const [method, url] of ENDPOINTS) await http()[method](url).set(auth(f.users.clientA)).send({}).expect(403);
    });

    it('/me: Developer and QA yes; PM, Executive and Admin no', async () => {
      await get(f.users.devA, '/daily-scrum/me').expect(200);
      await get(f.users.qaB, '/daily-scrum/me').expect(200);
      for (const u of [f.users.pm, f.users.exec, f.users.admin]) await get(u, '/daily-scrum/me').expect(403);
    });

    it('/team and /people/:id: PM, Executive and Admin yes; Developer and QA no', async () => {
      for (const u of [f.users.pm, f.users.exec, f.users.admin]) {
        await get(u, '/daily-scrum/team').expect(200);
        await get(u, `/daily-scrum/people/${f.users.devA.id}`).expect(200);
      }
      for (const u of [f.users.devA, f.users.qaB]) {
        await get(u, '/daily-scrum/team').expect(403);
        await get(u, `/daily-scrum/people/${f.users.devNone.id}`).expect(403);
      }
    });

    it('/people/:id is 404 for someone who is not Dev/QA, unknown, or in another tenant', async () => {
      await get(f.users.pm, `/daily-scrum/people/${f.users.pm.id}`).expect(404);
      await get(f.users.pm, '/daily-scrum/people/999999').expect(404);
      await get(f.users.pmT2, `/daily-scrum/people/${f.users.devA.id}`).expect(404);
    });

    it('settings: everyone above can read; only Admin and Program Manager can change', async () => {
      for (const u of [f.users.devA, f.users.qaB, f.users.pm, f.users.exec, f.users.admin]) await get(u, '/daily-scrum/settings').expect(200);
      for (const u of [f.users.devA, f.users.qaB, f.users.exec]) await patch(u, '/daily-scrum/settings', { workdayStart: '08:00' }).expect(403);
    });
  });

  describe('a Developer\'s own summary', () => {
    let body: any;
    beforeAll(async () => {
      body = (await get(f.users.devA, '/daily-scrum/me').expect(200)).body;
    });

    const groupIds = (items: any[]) => items.map((i) => i.taskId).sort((a: number, b: number) => a - b);
    const sorted = (...keys: string[]) => keys.map((k) => ids[k]).sort((a, b) => a - b);

    it('uses Addis Ababa when no settings are saved, from 00:00 of the last working day', () => {
      expect(body.settings).toMatchObject({ timeZone: 'Africa/Addis_Ababa', workdayStart: '07:30', workdayEnd: '15:30', isDefault: true });
      const w = computeScrumWindow(new Date(), 'Africa/Addis_Ababa');
      expect(body.window).toMatchObject({ timeZone: 'Africa/Addis_Ababa', today: w.today, lastWorkingDay: w.lastWorkingDay, since: w.since.toISOString() });
    });

    it('puts each active ticket in exactly one group', () => {
      const p = body.person;
      expect(groupIds(p.today)).toEqual(sorted('today'));
      expect(groupIds(p.withReviewers)).toEqual(sorted('inQaOverdue', 'inPeer'));
      expect(groupIds(p.blockers)).toEqual(sorted('overdue', 'failed', 'escalated', 'waiting', 'blocked'));
      expect(p.counts).toEqual({ today: 1, blockers: 5, withReviewers: 2, active: 8 });
      const all = [...p.today, ...p.blockers, ...p.withReviewers].map((i: any) => i.taskId);
      expect(new Set(all).size).toBe(all.length);
      for (const k of ['held', 'junk', 'passed', 'closed']) expect(all).not.toContain(ids[k]);
    });

    it('shows the reasons as chips; an overdue ticket in QA stays With reviewers', () => {
      const reasons = (key: string) => [...body.person.blockers, ...body.person.withReviewers].find((i: any) => i.taskId === ids[key]).reasons;
      expect(reasons('overdue')).toEqual(['overdue']);
      expect(reasons('failed')).toEqual(['sent_back']);
      expect(reasons('escalated')).toEqual(['intervention']);
      expect(reasons('waiting')).toEqual(['waiting_on_dependency']);
      expect(reasons('blocked')).toEqual(['blocking_defect']);
      expect(reasons('inQaOverdue')).toEqual(['overdue']);
    });

    it('lists what happened since the last working day - nothing older, nothing on Junk', () => {
      const since = body.person.since.map((e: any) => `${e.kind}:${e.taskId}`);
      expect(since).toEqual(
        expect.arrayContaining([`assigned:${ids.today}`, `submitted_for_review:${ids.inQaOverdue}`, `submitted_for_review:${ids.inPeer}`, `review_passed:${ids.passed}`, `dependency_raised:${ids.waiting}`]),
      );
      expect(since).not.toContain(`review_sent_back:${ids.failed}`);
      expect(since.some((s: string) => s.endsWith(`:${ids.junk}`))).toBe(false);
      expect(since.some((s: string) => s.endsWith(`:${ids.held}`))).toBe(true); // dependency raised on it
      expect(body.person.qa).toBeNull();
    });
  });

  describe('dependencies and peer reviews belong to the person who must act', () => {
    it('devNone sees the dependency and the peer review as reference lists, not as their own work', async () => {
      const p = (await get(f.users.devNone, '/daily-scrum/me').expect(200)).body.person;
      expect(p.waitingOnYou.map((d: any) => d.parentTaskId)).toEqual([ids.waiting]); // the held one is left out
      expect(p.waitingOnYou[0].requestedByName).toBe('Name devA');
      expect(p.peerReviewsToDo.map((r: any) => r.taskId)).toEqual([ids.inPeer]);
      expect(p.counts).toEqual({ today: 1, blockers: 0, withReviewers: 0, active: 1 }); // only their defect
      expect(p.today[0].taskId).toBe(ids.defect);
    });
  });

  describe('QA', () => {
    it('gets test-case totals for the window and the QA queue', async () => {
      const p = (await get(f.users.qaB, '/daily-scrum/me').expect(200)).body.person;
      expect(p.qa).toEqual({
        executions: { passed: 2, failed: 1, blocked: 0, total: 3 },
        queue: { pendingQa: 1, resubmissions: 0, myOpenDefects: 1 },
      });
      expect(p.since.map((e: any) => `${e.kind}:${e.taskId}`)).toEqual(expect.arrayContaining([`reviewed_approved:${ids.passed}`]));
    });

    it('counts the QA queue exactly like the QA Review list and its badge', async () => {
      const p = (await get(f.users.qaB, '/daily-scrum/me').expect(200)).body.person;
      const queue = (await get(f.users.qaB, '/tasks/qa-queue?include=defects').expect(200)).body;
      expect(p.qa.queue.pendingQa).toBe(queue.statCounts.pending);
      expect(p.qa.queue.resubmissions).toBe(queue.statCounts.resubmissions);
    });
  });

  describe('Team tab', () => {
    it('has every Developer and QA, each blocker once, and the totals match', async () => {
      const body = (await get(f.users.pm, '/daily-scrum/team').expect(200)).body;
      expect(body.people.map((p: any) => p.userId).sort()).toEqual([f.users.devA.id, f.users.devNone.id, f.users.qaB.id].sort());
      expect(body.totals).toEqual({ today: 2, blockers: 5, withReviewers: 2, active: 9 });
      expect(body.activeTicketCount).toBe(9);
      expect(body.totalsMatch).toBe(true);
      const attention = body.needsAttention.map((n: any) => n.taskId);
      expect(attention).toHaveLength(5);
      expect(new Set(attention).size).toBe(5);
    });

    it('the Individual tab shows the same summary as the person\'s own', async () => {
      const own = (await get(f.users.devA, '/daily-scrum/me').expect(200)).body.person;
      const viaPm = (await get(f.users.pm, `/daily-scrum/people/${f.users.devA.id}`).expect(200)).body.person;
      expect(viaPm.counts).toEqual(own.counts);
    });
  });

  describe('read-only', () => {
    const snapshot = async () =>
      ds.query(`SELECT
        (SELECT count(*)::int FROM project_tasks) tasks, (SELECT max("updatedAt") FROM project_tasks) tasks_updated,
        (SELECT count(*)::int FROM task_qa_reviews) reviews, (SELECT count(*)::int FROM task_qa_reviews WHERE status = 'pending') pending,
        (SELECT count(*)::int FROM task_dependency_tickets WHERE status = 'open') open_deps,
        (SELECT count(*)::int FROM audit_logs) audits, (SELECT count(*)::int FROM user_notifications) notifications,
        (SELECT count(*)::int FROM kpi_period_score) kpi, (SELECT count(*)::int FROM sla_configs) sla,
        (SELECT count(*)::int FROM test_executions) runs, (SELECT count(*)::int FROM team_settings) settings,
        (SELECT count(*)::int FROM scrum_external_waits) waits`);

    it('calling every GET as every role changes nothing anywhere - not even a settings row', async () => {
      const before = await snapshot();
      for (const u of [f.users.devA, f.users.devNone, f.users.qaB, f.users.pm, f.users.exec, f.users.admin]) {
        for (const url of ['/daily-scrum/me', '/daily-scrum/team', `/daily-scrum/people/${f.users.devA.id}`, '/daily-scrum/settings', '/daily-scrum/external-waits?status=all']) await get(u, url);
      }
      expect(await snapshot()).toEqual(before);
      expect(before[0].settings).toBe(0);
    });
  });

  describe('settings', () => {
    it('refuses an unknown time zone, a bad time, and start not before end', async () => {
      expect((await patch(f.users.pm, '/daily-scrum/settings', { timeZone: 'Mars/Phobos' }).expect(400)).body.message).toMatch(/not a recognised time zone/);
      await patch(f.users.pm, '/daily-scrum/settings', { workdayStart: '25:00' }).expect(400);
      await patch(f.users.pm, '/daily-scrum/settings', { workdayEnd: '7:30' }).expect(400);
      expect((await patch(f.users.pm, '/daily-scrum/settings', { workdayStart: '16:00' }).expect(400)).body.message).toMatch(/before/);
      expect((await ds.query(`SELECT count(*)::int n FROM team_settings`))[0].n).toBe(0);
      expect((await ds.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'daily_scrum_settings_updated'`))[0].n).toBe(0);
    });

    it('Program Manager saves a change; it is audited with before and after, and used by the window', async () => {
      const saved = (await patch(f.users.pm, '/daily-scrum/settings', { timeZone: 'Pacific/Kiritimati', workdayStart: '08:00' }).expect(200)).body;
      expect(saved).toMatchObject({ timeZone: 'Pacific/Kiritimati', workdayStart: '08:00', workdayEnd: '15:30', isDefault: false, updatedByUserId: f.users.pm.id, updatedByName: 'Name pm' });
      const audit = (await ds.query(`SELECT * FROM audit_logs WHERE action = 'daily_scrum_settings_updated'`))[0];
      expect(audit).toMatchObject({ userId: f.users.pm.id, entityType: 'TeamSettings', entityId: f.tenants.t1 });
      expect(JSON.parse(audit.details)).toEqual({
        before: { timeZone: 'Africa/Addis_Ababa', workdayStart: '07:30', workdayEnd: '15:30' },
        after: { timeZone: 'Pacific/Kiritimati', workdayStart: '08:00', workdayEnd: '15:30' },
      });
      const w = (await get(f.users.devA, '/daily-scrum/me').expect(200)).body.window;
      expect(w.timeZone).toBe('Pacific/Kiritimati');
      expect(w.today).toBe(computeScrumWindow(new Date(), 'Pacific/Kiritimati').today);
    });

    it('Admin can change it back; settings are per tenant', async () => {
      await patch(f.users.admin, '/daily-scrum/settings', { timeZone: 'Africa/Addis_Ababa', workdayStart: '07:30' }).expect(200);
      expect((await ds.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'daily_scrum_settings_updated'`))[0].n).toBe(2);
      const otherTenant = (await get(f.users.pmT2, '/daily-scrum/settings').expect(200)).body;
      expect(otherTenant).toMatchObject({ timeZone: 'Africa/Addis_Ababa', isDefault: true });
    });
  });

  // Stage 3 (2026-10-16): "Waiting on the city office" - a hand-kept list.
  describe('external waits', () => {
    const URL = '/daily-scrum/external-waits';
    const base = { title: 'Building permit stamp', requestedOn: '2026-10-12' };

    it('PM/Executive/Admin can list; only Admin and PM can add or change; Developer and QA get 403', async () => {
      for (const u of [f.users.pm, f.users.exec, f.users.admin]) await get(u, URL).expect(200);
      for (const u of [f.users.devA, f.users.qaB]) await get(u, URL).expect(403);
      for (const u of [f.users.devA, f.users.qaB, f.users.exec]) {
        await post(u, URL, base).expect(403);
        await patch(u, `${URL}/1`, { status: 'resolved' }).expect(403);
      }
      expect((await ds.query(`SELECT count(*)::int n FROM scrum_external_waits`))[0].n).toBe(0);
    });

    it('refuses a missing title or date, a ticket or person from another tenant, and expected before requested', async () => {
      await post(f.users.pm, URL, { requestedOn: '2026-10-12' }).expect(400);
      await post(f.users.pm, URL, { title: '   ', requestedOn: '2026-10-12' }).expect(400);
      await post(f.users.pm, URL, { title: 'x' }).expect(400);
      await post(f.users.pm, URL, { ...base, taskId: 999999 }).expect(400);
      await post(f.users.pm, URL, { ...base, followUpUserId: f.users.pmT2.id }).expect(400);
      await post(f.users.pm, URL, { ...base, followUpUserId: f.users.clientA.id }).expect(400);
      expect((await post(f.users.pm, URL, { ...base, expectedBy: '2026-10-01' }).expect(400)).body.message).toMatch(/before/);
      await get(f.users.pm, `${URL}?status=bogus`).expect(400);
      expect((await ds.query(`SELECT count(*)::int n FROM scrum_external_waits`))[0].n).toBe(0);
    });

    it('PM adds one (City office by default), it is audited, and shows with ticket and names', async () => {
      const created = (
        await post(f.users.pm, URL, { ...base, taskId: ids.waiting, followUpUserId: f.users.devA.id, expectedBy: '2026-10-20', note: '  call Tuesday  ' }).expect(201)
      ).body;
      expect(created).toMatchObject({
        title: 'Building permit stamp',
        party: 'City office',
        taskId: ids.waiting,
        taskTitle: 'Task waiting',
        followUpUserId: f.users.devA.id,
        followUpName: 'Name devA',
        requestedOn: '2026-10-12',
        expectedBy: '2026-10-20',
        note: 'call Tuesday',
        status: 'open',
        createdByName: 'Name pm',
      });
      const audit = (await ds.query(`SELECT * FROM audit_logs WHERE action = 'daily_scrum_external_wait_created'`))[0];
      expect(audit).toMatchObject({ userId: f.users.pm.id, entityType: 'ScrumExternalWait', entityId: created.id });
      expect(JSON.parse(audit.details).after.title).toBe('Building permit stamp');
      const list = (await get(f.users.exec, URL).expect(200)).body;
      expect(list.map((w: any) => w.id)).toEqual([created.id]);
      expect((await get(f.users.pmT2, URL).expect(200)).body).toEqual([]);
    });

    it('Admin edits and resolves it; resolved ones leave the open list; reopen works; each change audited', async () => {
      const id = (await get(f.users.pm, URL).expect(200)).body[0].id;
      const edited = (await patch(f.users.admin, `${URL}/${id}`, { party: 'Sub-city office', expectedBy: null }).expect(200)).body;
      expect(edited).toMatchObject({ party: 'Sub-city office', expectedBy: null, status: 'open' });
      const upd = (await ds.query(`SELECT details FROM audit_logs WHERE action = 'daily_scrum_external_wait_updated'`))[0];
      expect(JSON.parse(upd.details)).toEqual({ before: { party: 'City office', expectedBy: '2026-10-20' }, after: { party: 'Sub-city office', expectedBy: null } });

      const resolved = (await patch(f.users.admin, `${URL}/${id}`, { status: 'resolved' }).expect(200)).body;
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolvedByName).toBe('Name admin');
      expect(resolved.resolvedAt).toBeTruthy();
      expect((await get(f.users.pm, URL).expect(200)).body).toEqual([]);
      expect((await get(f.users.pm, `${URL}?status=resolved`).expect(200)).body.map((w: any) => w.id)).toEqual([id]);

      const reopened = (await patch(f.users.pm, `${URL}/${id}`, { status: 'open' }).expect(200)).body;
      expect(reopened).toMatchObject({ status: 'open', resolvedAt: null, resolvedByName: null });
      const actions = (await ds.query(`SELECT action FROM audit_logs WHERE "entityType" = 'ScrumExternalWait' ORDER BY id`)).map((r: any) => r.action);
      expect(actions).toEqual([
        'daily_scrum_external_wait_created',
        'daily_scrum_external_wait_updated',
        'daily_scrum_external_wait_resolved',
        'daily_scrum_external_wait_reopened',
      ]);
    });

    it('a no-change save writes no audit row; another tenant gets 404; never touches a ticket', async () => {
      const id = (await get(f.users.pm, URL).expect(200)).body[0].id;
      const before = await ds.query(`SELECT count(*)::int a FROM audit_logs`);
      const taskBefore = await ds.query(`SELECT status, "updatedAt" FROM project_tasks WHERE id = $1`, [ids.waiting]);
      await patch(f.users.pm, `${URL}/${id}`, { party: 'Sub-city office' }).expect(200);
      expect(await ds.query(`SELECT count(*)::int a FROM audit_logs`)).toEqual(before);
      await patch(f.users.pmT2, `${URL}/${id}`, { status: 'resolved' }).expect(404);
      expect(await ds.query(`SELECT status, "updatedAt" FROM project_tasks WHERE id = $1`, [ids.waiting])).toEqual(taskBefore);
    });
  });
});
