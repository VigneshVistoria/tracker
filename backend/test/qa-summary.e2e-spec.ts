import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// QA Review summary (2026-10-13): five read-only tiles and their
// drill-down lists. Every tile's number must equal its list, Junk/Hold and
// Peer Review rounds never count, escalations aren't rejections, Waiting
// is the QA Review list itself, QA only sees their own numbers. Periods
// are whole days in the team's time zone (2026-10-13).
describe('QA Review summary (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  let qaOther: FixtureUser;
  const ids: Record<string, number> = {};

  const IN = '2026-10-15T10:00:00Z';
  const IN2 = '2026-10-20T10:00:00Z';
  const IN3 = '2026-10-25T10:00:00Z';
  const BEFORE = '2026-09-15T10:00:00Z';
  const PERIOD = 'period=custom&from=2026-10-01&to=2026-10-31';

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const summary = async (u: FixtureUser, extra = '') => (await get(u, `/tasks/qa-summary?${PERIOD}${extra}`).expect(200)).body;
  const items = async (u: FixtureUser, tile: string, extra = '') =>
    (await get(u, `/tasks/qa-summary/items?tile=${tile}&${PERIOD}${extra}`).expect(200)).body;
  const idsOf = (rows: any[]) => rows.map((r) => r.id).sort((a, b) => a - b);
  const keys = (...names: string[]) => names.map((n) => ids[n]).sort((a, b) => a - b);
  const TILES = ['defectsRaised', 'approved', 'rejected', 'waiting', 'refeedback'];

  const task = async (key: string, values: Record<string, any> = {}) => {
    const row = {
      tenantId: f.tenants.t1,
      projectId: f.projects.pA,
      projectName: 'Project A',
      moduleId: f.modules.mA,
      moduleName: 'Medical Claim',
      phaseId,
      phaseName: 'Build',
      title: `Ticket ${key}`,
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
    ids[key] = res[0].id;
  };
  const defect = (key: string, qa: FixtureUser, createdAt: string, values: Record<string, any> = {}) =>
    task(key, { isDefect: true, createdByUserId: qa.id, createdByEmail: qa.email, createdAt, ...values });

  const round = (
    key: string,
    roundNumber: number,
    status: string,
    reviewer: FixtureUser | null,
    at: string | null,
    opts: { reviewType?: string; submittedBy?: FixtureUser } = {},
  ) => {
    const submitter = opts.submittedBy || f.users.devA;
    return ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", "resolution", "submittedByUserId", "submittedByEmail", "status", "reviewType", "reviewedByUserId", "reviewedByEmail", "reviewedAt")
       VALUES ($1, $2, $3, 'done', $4, $5, $6, $7, $8, $9, $10)`,
      [f.tenants.t1, ids[key], roundNumber, submitter.id, submitter.email, status, opts.reviewType || 'qa', reviewer?.id ?? null, reviewer?.email ?? null, at],
    );
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_blocking_defects, user_notifications, audit_logs RESTART IDENTITY CASCADE`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    const otherId = (
      await ds.query(
        `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, 'qaOther@test.local', 'x', 'Name qaOther', 'qa') RETURNING id`,
        [f.tenants.t1],
      )
    )[0].id;
    qaOther = { id: otherId, email: 'qaOther@test.local', tenantId: f.tenants.t1, role: 'qa' };
    const { qaB, devNone } = f.users;

    // Rejected twice, then approved - once in each tile, "2 rejections".
    await task('T1', { status: 'Pass' });
    await round('T1', 1, 'rejected', qaB, IN);
    await round('T1', 2, 'rejected', qaB, IN2);
    await round('T1', 3, 'approved', qaB, IN3);
    // Rejected, resubmitted, waiting again.
    await task('T2', { status: 'Re-Feedback' });
    await round('T2', 1, 'rejected', qaB, IN);
    await round('T2', 2, 'pending', null, null);
    // First submission, waiting.
    await task('T3', { status: 'Feedback' });
    await round('T3', 1, 'pending', null, null);
    // Approved by the other QA.
    await task('T4', { status: 'Pass' });
    await round('T4', 1, 'approved', qaOther, IN);
    // Approved before the period.
    await task('T5', { status: 'Pass' });
    await round('T5', 1, 'approved', qaB, BEFORE);
    // Rejected in the period, now Junk - with a stray pending round too.
    await task('T6', { status: 'Junk' });
    await round('T6', 1, 'rejected', qaB, IN);
    await round('T6', 2, 'pending', null, null);
    // Approved in the period, now on Hold.
    await task('T7', { status: 'Hold' });
    await round('T7', 1, 'approved', qaB, IN);
    // Escalated to PM - not a rejection.
    await task('T8', { status: 'Escalated' });
    await round('T8', 1, 'escalated', qaB, IN);
    // A Peer Review rejection - never a QA number.
    await task('T9', { status: 'Failed', peerReviewEnabled: true });
    await round('T9', 1, 'rejected', devNone, IN, { reviewType: 'peer' });
    // Project B, submitted by another developer.
    await task('T10', { status: 'Pass', projectId: f.projects.pB, projectName: 'Project B', assigneeUserId: devNone.id, assigneeEmail: devNone.email });
    await round('T10', 1, 'approved', qaB, IN, { submittedBy: devNone });

    await defect('D1', qaB, IN);
    await defect('D2', qaB, IN, { status: 'Feedback' });
    await round('D2', 1, 'pending', null, null);
    await defect('D3', qaB, BEFORE, { status: 'Failed' });
    await round('D3', 1, 'rejected', qaB, IN);
    await defect('D4', qaOther, IN, { status: 'Hold' });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('guards', () => {
    it('401 without login, 403 for Developer and Client', async () => {
      await http().get(`/tasks/qa-summary?${PERIOD}`).expect(401);
      await http().get(`/tasks/qa-summary/items?tile=approved&${PERIOD}`).expect(401);
      await get(f.users.devA, `/tasks/qa-summary?${PERIOD}`).expect(403);
      await get(f.users.devA, `/tasks/qa-summary/items?tile=approved&${PERIOD}`).expect(403);
      await get(f.users.clientA, `/tasks/qa-summary?${PERIOD}`).expect(403);
    });

    it("a QA can't ask for another QA's numbers", async () => {
      await get(f.users.qaB, `/tasks/qa-summary?${PERIOD}&qaUserId=${qaOther.id}`).expect(403);
      await get(f.users.qaB, `/tasks/qa-summary/items?tile=approved&${PERIOD}&qaUserId=${qaOther.id}`).expect(403);
      await get(f.users.qaB, `/tasks/qa-summary?${PERIOD}&qaUserId=${f.users.qaB.id}`).expect(200);
    });

    it('rejects a bad tile or period', async () => {
      await get(f.users.pm, `/tasks/qa-summary/items?tile=nope&${PERIOD}`).expect(400);
      await get(f.users.pm, '/tasks/qa-summary').expect(400);
      await get(f.users.pm, '/tasks/qa-summary?period=last30').expect(400);
      await get(f.users.pm, '/tasks/qa-summary?period=custom&from=2026-10-10&to=2026-10-01').expect(400);
      await get(f.users.pm, '/tasks/qa-summary?period=custom&from=2025-10-01&to=2026-10-02').expect(400);
      await get(f.users.pm, '/tasks/qa-summary?period=custom&from=2025-10-01&to=2026-10-01').expect(200);
      // The old browser-computed instants are no longer accepted.
      await get(f.users.pm, '/tasks/qa-summary?period=custom&from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z').expect(400);
      await get(f.users.pm, '/tasks/qa-summary?period=this_month').expect(200);
    });
  });

  it("QA: their own numbers, each tile equal to its list", async () => {
    const s = await summary(f.users.qaB);
    expect(s.counts).toEqual({ defectsRaised: 2, approved: 2, rejected: 3, waiting: 2, refeedback: 1 });
    expect(s.passRate).toBe(40);
    expect(s.qas).toEqual([]);
    expect(s.range).toEqual({ period: 'custom', from: '2026-10-01', to: '2026-10-31', timeZone: 'Africa/Addis_Ababa' });
    expect(idsOf(await items(f.users.qaB, 'defectsRaised'))).toEqual(keys('D1', 'D2'));
    expect(idsOf(await items(f.users.qaB, 'approved'))).toEqual(keys('T1', 'T10'));
    expect(idsOf(await items(f.users.qaB, 'rejected'))).toEqual(keys('T1', 'T2', 'D3'));
    expect(idsOf(await items(f.users.qaB, 'waiting'))).toEqual(keys('T3', 'D2'));
    expect(idsOf(await items(f.users.qaB, 'refeedback'))).toEqual(keys('T2'));
    // Even asking for "All", a QA gets only their own.
    expect((await summary(f.users.qaB, '&qaUserId=all')).counts).toEqual(s.counts);
  });

  it('a ticket rejected twice counts once, with its rejection count and latest date', async () => {
    const rows = await items(f.users.qaB, 'rejected');
    const t1 = rows.find((r: any) => r.id === ids.T1);
    expect(t1.rejections).toBe(2);
    expect(new Date(t1.happenedAt).toISOString()).toBe(new Date(IN2).toISOString());
    expect(t1).toMatchObject({ qaUserId: f.users.qaB.id, qaName: 'Name qaB', developerName: 'Name devA', status: 'Pass', isDefect: false });
    expect(t1.approvals).toBeNull();
    const approved = (await items(f.users.qaB, 'approved')).find((r: any) => r.id === ids.T1);
    expect(approved).toMatchObject({ approvals: 1, rejections: null });
  });

  it('Waiting/Re-feedback show the round, earlier rejections, and "Any QA" for tasks', async () => {
    const rows = await items(f.users.qaB, 'waiting');
    const refeedback = await items(f.users.qaB, 'refeedback');
    expect(refeedback.find((r: any) => r.id === ids.T2)).toMatchObject({ round: 2, rejections: 1, qaUserId: null, status: 'Re-Feedback' });
    expect(rows.find((r: any) => r.id === ids.T3)).toMatchObject({ round: 1, rejections: 0, qaUserId: null });
    expect(rows.find((r: any) => r.id === ids.D2)).toMatchObject({ round: 1, isDefect: true, qaUserId: f.users.qaB.id });
  });

  it('Waiting + Re-feedback never overlap and together equal the QA Review list and its badge', async () => {
    for (const u of [f.users.qaB, f.users.pm]) {
      const queue = (await get(u, '/tasks/qa-queue?include=defects').expect(200)).body;
      const waiting = await items(u, 'waiting');
      const refeedback = await items(u, 'refeedback');
      expect(waiting.every((r: any) => r.status === 'Feedback')).toBe(true);
      expect(refeedback.every((r: any) => r.status === 'Re-Feedback')).toBe(true);
      expect(idsOf(waiting).filter((id: number) => idsOf(refeedback).includes(id))).toEqual([]);
      expect([...idsOf(waiting), ...idsOf(refeedback)].sort((a: number, b: number) => a - b)).toEqual([...idsOf(queue.tasks)].sort((a: number, b: number) => a - b));
      const s = await summary(u);
      expect(s.counts.waiting + s.counts.refeedback).toBe(queue.statCounts.pending);
      expect(s.counts.refeedback).toBe(queue.statCounts.resubmissions);
    }
  });

  it('the other QA, picked by PM, gets only their decisions and the shared tasks', async () => {
    const s = await summary(f.users.pm, `&qaUserId=${qaOther.id}`);
    expect(s.counts).toEqual({ defectsRaised: 0, approved: 1, rejected: 0, waiting: 1, refeedback: 1 });
    expect(s.passRate).toBe(100);
    expect(idsOf(await items(f.users.pm, 'approved', `&qaUserId=${qaOther.id}`))).toEqual(keys('T4'));
    expect((await summary(qaOther)).counts).toEqual(s.counts);
  });

  it('PM and Admin see All, with the QA picker list', async () => {
    for (const u of [f.users.pm, f.users.admin]) {
      const s = await summary(u);
      expect(s.counts).toEqual({ defectsRaised: 2, approved: 3, rejected: 3, waiting: 2, refeedback: 1 });
      expect(s.passRate).toBe(50);
      expect(s.qas.map((q: any) => q.id).sort()).toEqual([f.users.qaB.id, qaOther.id].sort());
      for (const tile of TILES) expect((await items(u, tile)).length).toBe(s.counts[tile]);
    }
  });

  it('soleQaName is the only QA-role user, or null when there are two or more', async () => {
    for (const u of [f.users.pm, f.users.qaB]) expect((await summary(u)).soleQaName).toBeNull();
    await ds.query(`UPDATE users SET role = 'developer' WHERE id = $1`, [qaOther.id]);
    try {
      for (const u of [f.users.pm, f.users.qaB]) expect((await summary(u)).soleQaName).toBe('Name qaB');
      // Display only - the waiting rows still have no QA.
      const rows = await items(f.users.pm, 'waiting');
      expect(rows.filter((r: any) => !r.isDefect).every((r: any) => r.qaUserId === null && r.qaName === null)).toBe(true);
    } finally {
      await ds.query(`UPDATE users SET role = 'qa' WHERE id = $1`, [qaOther.id]);
    }
  });

  it('Executive sees All, tasks only', async () => {
    const s = await summary(f.users.exec);
    expect(s.includeDefects).toBe(false);
    expect(s.counts).toEqual({ defectsRaised: 0, approved: 3, rejected: 2, waiting: 1, refeedback: 1 });
    expect(idsOf(await items(f.users.exec, 'rejected'))).toEqual(keys('T1', 'T2'));
  });

  it('Project and Developer filters narrow every tile, and the options cover all rows', async () => {
    const s = await summary(f.users.pm, `&projectId=${f.projects.pB}`);
    expect(s.counts).toEqual({ defectsRaised: 0, approved: 1, rejected: 0, waiting: 0, refeedback: 0 });
    expect(s.projects.map((p: any) => p.id).sort()).toEqual([f.projects.pA, f.projects.pB].sort());
    const d = await summary(f.users.pm, `&developerUserId=${f.users.devNone.id}`);
    expect(d.counts.approved).toBe(1);
    expect(idsOf(await items(f.users.pm, 'approved', `&developerUserId=${f.users.devNone.id}`))).toEqual(keys('T10'));
  });

  it('every tile equals its list for every role and filter combination', async () => {
    const combos: Array<[FixtureUser, string]> = [
      [f.users.qaB, ''],
      [qaOther, ''],
      [f.users.pm, ''],
      [f.users.pm, `&qaUserId=${f.users.qaB.id}`],
      [f.users.pm, `&projectId=${f.projects.pA}`],
      [f.users.exec, ''],
    ];
    for (const [u, extra] of combos) {
      const s = await summary(u, extra);
      for (const tile of TILES) {
        const rows = await items(u, tile, extra);
        expect(rows.length).toBe(s.counts[tile]);
        expect(new Set(rows.map((r: any) => r.id)).size).toBe(rows.length);
      }
    }
  });

  it('never lists Junk or Hold tickets, escalations or peer rounds', async () => {
    const excluded = keys('T6', 'T7', 'T8', 'T9', 'D4');
    for (const u of [f.users.pm, f.users.qaB, qaOther]) {
      for (const tile of TILES) {
        for (const row of await items(u, tile)) expect(excluded).not.toContain(row.id);
      }
    }
  });

  // 23:59 / 00:01 team time on the first and last day of a month, and
  // the team_settings zone moving those edges. Its own QA, so the rows
  // can be filtered apart, and removed again afterwards.
  it('period edges follow the team time zone, not UTC', async () => {
    const qaEdge: FixtureUser = {
      id: (
        await ds.query(
          `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, 'qaEdge@test.local', 'x', 'Name qaEdge', 'qa') RETURNING id`,
          [f.tenants.t1],
        )
      )[0].id,
      email: 'qaEdge@test.local',
      tenantId: f.tenants.t1,
      role: 'qa',
    };
    const at = (period: string) => `period=custom&${period}&qaUserId=${qaEdge.id}`;
    const OCT = at('from=2026-10-01&to=2026-10-31');
    const SEP = at('from=2026-09-01&to=2026-09-30');
    const NOV = at('from=2026-11-01&to=2026-11-30');
    const list = async (tile: string, q: string) => (await get(f.users.pm, `/tasks/qa-summary/items?tile=${tile}&${q}`).expect(200)).body;
    try {
      // Sep 30 23:59 EAT - September, although Oct 1 in some zones.
      await task('E1', { status: 'Pass' });
      await round('E1', 1, 'approved', qaEdge, '2026-09-30T20:59:00Z');
      // Oct 1 00:01 and Oct 31 23:59 EAT - both October, so one row, 2 approvals.
      await task('E2', { status: 'Pass' });
      await round('E2', 1, 'approved', qaEdge, '2026-09-30T21:01:00Z');
      await round('E2', 2, 'approved', qaEdge, '2026-10-31T20:59:00Z');
      // Nov 1 00:01 EAT - November, although still Oct 31 in UTC.
      await defect('E3', qaEdge, '2026-10-31T21:01:00Z');
      // Exactly Sep 1 00:00 EAT - the first instant of September.
      await task('E4', { status: 'Failed' });
      await round('E4', 1, 'rejected', qaEdge, '2026-08-31T21:00:00Z');

      expect(idsOf(await list('approved', OCT))).toEqual(keys('E2'));
      expect((await list('approved', OCT))[0].approvals).toBe(2);
      expect(await list('rejected', OCT)).toEqual([]);
      expect(await list('defectsRaised', OCT)).toEqual([]);
      expect(idsOf(await list('approved', SEP))).toEqual(keys('E1'));
      expect(idsOf(await list('rejected', SEP))).toEqual(keys('E4'));
      expect(idsOf(await list('defectsRaised', NOV))).toEqual(keys('E3'));
      expect((await get(f.users.pm, `/tasks/qa-summary?${OCT}`).expect(200)).body.counts).toMatchObject({ approved: 1, rejected: 0, defectsRaised: 0 });

      // Team zone set to India (+05:30): Sep 30 20:59 UTC is now October,
      // and Oct 31 20:59 UTC is November.
      await ds.query(`INSERT INTO team_settings ("tenantId", "timeZone") VALUES ($1, 'Asia/Kolkata')`, [f.tenants.t1]);
      const ist = (await get(f.users.pm, `/tasks/qa-summary?${OCT}`).expect(200)).body;
      expect(ist.range.timeZone).toBe('Asia/Kolkata');
      expect(idsOf(await list('approved', OCT))).toEqual(keys('E1', 'E2'));
      expect((await list('approved', OCT)).find((r: any) => r.id === ids.E2).approvals).toBe(1);
    } finally {
      await ds.query(`DELETE FROM team_settings WHERE "tenantId" = $1`, [f.tenants.t1]);
      const edgeIds = ['E1', 'E2', 'E3', 'E4'].map((k) => ids[k]).filter(Boolean);
      if (edgeIds.length) {
        await ds.query(`DELETE FROM task_qa_reviews WHERE "taskId" = ANY($1)`, [edgeIds]);
        await ds.query(`DELETE FROM project_tasks WHERE id = ANY($1)`, [edgeIds]);
      }
      await ds.query(`DELETE FROM users WHERE id = $1`, [qaEdge.id]);
    }
  });

  it('is read-only: no ticket or round changes', async () => {
    const snapshot = () =>
      ds.query(`SELECT (SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM project_tasks t) tasks,
                       (SELECT md5(string_agg(r::text, ',' ORDER BY id)) FROM task_qa_reviews r) rounds,
                       (SELECT count(*) FROM audit_logs) audit`);
    const before = await snapshot();
    await summary(f.users.pm);
    for (const tile of TILES) await items(f.users.qaB, tile);
    expect(await snapshot()).toEqual(before);
  });
});
