import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Dashboard cards (2026-11-04, user feedback): every card's number must
// equal the rows of the list it opens. Each backend count is checked
// against the list the card links to, with the same query.
describe('Dashboard card counts match their lists (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  const ids: Record<string, number> = {};

  const get = (u: FixtureUser, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(u)}`);
  const idsOf = (rows: Array<{ id: number }>) => rows.map((r) => r.id).sort((a, b) => a - b);
  const pick = (...keys: string[]) => keys.map((k) => ids[k]).sort((a, b) => a - b);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_dependency_tickets, task_qa_reviews RESTART IDENTITY CASCADE`);
    const phase = async (tenantId: number, projectId: number) =>
      (
        await ds.query(
          `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
          [tenantId, projectId, f.modules.mA],
        )
      )[0].id as number;
    const phaseT1 = await phase(f.tenants.t1, f.projects.pA);
    const phaseT2 = await phase(f.tenants.t2, f.projects.pT2);
    const insert = async (key: string, v: Record<string, any>) => {
      const assignee: FixtureUser | null = v.assignee === undefined ? f.users.devA : v.assignee;
      const row: Record<string, any> = {
        tenantId: v.tenantId ?? f.tenants.t1,
        projectId: f.projects.pA,
        projectName: 'Project A',
        moduleId: f.modules.mA,
        moduleName: 'Medical Claim',
        phaseId: (v.tenantId ?? f.tenants.t1) === f.tenants.t1 ? phaseT1 : phaseT2,
        phaseName: 'Build',
        title: key,
        description: 'x',
        status: v.status ?? 'Development',
        assigneeUserId: assignee ? assignee.id : null,
        assigneeEmail: assignee ? assignee.email : null,
        createdByUserId: (v.createdBy ?? f.users.pm).id,
        createdByEmail: (v.createdBy ?? f.users.pm).email,
        dueDate: v.dueDate ?? null,
        isDefect: v.isDefect ?? false,
        completedAt: v.completedAt ?? null,
        pmWaitWorkingDays: v.pmWaitWorkingDays ?? 0,
      };
      const cols = Object.keys(row);
      const [r] = await ds.query(
        `INSERT INTO project_tasks (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        Object.values(row),
      );
      ids[key] = r.id;
    };
    const past = '2020-01-06';
    const future = '2099-01-05';
    // Overdue candidates - only the developer's own work counts.
    await insert('devOverdue', { dueDate: past });
    await insert('failedOverdue', { status: 'Failed', dueDate: past });
    await insert('pmFeedbackOverdue', { status: 'PM Feedback', dueDate: past });
    await insert('devOnTime', { dueDate: future });
    await insert('devNoDue', {});
    // Past due but with a reviewer / PM / paused / done - never overdue.
    for (const status of ['Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review', 'Pending PM Review', 'Returned to QA', 'Disputed', 'Hold', 'Closed', 'Junk']) {
      await insert(`past ${status}`, { status, dueDate: past });
    }
    await insert('pastPass', { status: 'Pass', dueDate: past, completedAt: '2026-10-15 10:00:00' });
    await insert('pastReleased', { status: 'Released - No Showstoppers', dueDate: past, completedAt: '2026-10-31 23:59:00' });
    await insert('releasedWith', { status: 'Released - With Showstoppers', completedAt: '2026-10-01 00:00:00' });
    // Passed outside the period, and a Junk that once passed.
    await insert('passSeptember', { status: 'Pass', completedAt: '2026-09-30 23:59:59' });
    await insert('passNovember', { status: 'Pass', completedAt: '2026-11-01 00:00:00' });
    await insert('junkCompleted', { status: 'Junk', completedAt: '2026-10-10 10:00:00' });
    // Other assignee, unassigned, other tenant.
    await insert('qaPersonOverdue', { assignee: f.users.qaB, dueDate: past });
    await insert('qaPersonPass', { assignee: f.users.qaB, status: 'Pass', completedAt: '2026-10-20 10:00:00' });
    await insert('unassignedPass', { assignee: null, status: 'Pass', completedAt: '2026-10-20 10:00:00' });
    await insert('otherTenantOverdue', { tenantId: f.tenants.t2, assignee: f.users.pmT2, dueDate: past });
    // Defects raised by qaB (one unassigned), in every kind of status.
    const defect = (key: string, status: string, extra: Record<string, any> = {}) =>
      insert(key, { status, isDefect: true, createdBy: f.users.qaB, ...extra });
    await defect('defectDev', 'Development');
    await defect('defectFeedback', 'Feedback');
    await defect('defectReFeedback', 'Re-Feedback');
    await defect('defectFailed', 'Failed');
    await defect('defectNotReady', 'Not Ready for Testing');
    await defect('defectDisputed', 'Disputed');
    await defect('defectUnassigned', 'Development', { assignee: null });
    await defect('defectHold', 'Hold');
    await defect('defectClosed', 'Closed');
    await defect('defectPass', 'Pass', { completedAt: '2026-10-05 10:00:00' });
    await defect('defectJunk', 'Junk');
    // A defect raised by someone else - not qaB's.
    await insert('defectByPm', { status: 'Development', isDefect: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('Overdue: statCounts.overdue equals the overdue=Yes list, which leaves out reviewer/PM/paused/done work', async () => {
    const card = (await get(f.users.pm, '/tasks/team?pageSize=1').expect(200)).body;
    const list = (await get(f.users.pm, '/tasks/team?overdue=Yes&all=true').expect(200)).body;
    expect(list.total).toBe(card.statCounts.overdue);
    expect(idsOf(list.tasks)).toEqual(pick('devOverdue', 'failedOverdue', 'pmFeedbackOverdue', 'qaPersonOverdue'));
  });

  it('Overdue: the same holds with Hold/Closed shown and for one assignee', async () => {
    const card = (await get(f.users.admin, '/tasks/team?pageSize=1&showHoldClosed=true').expect(200)).body;
    const list = (await get(f.users.admin, '/tasks/team?overdue=Yes&all=true&showHoldClosed=true').expect(200)).body;
    expect(list.total).toBe(card.statCounts.overdue);
    const one = (await get(f.users.exec, `/tasks/team?pageSize=1&assigneeUserId=${f.users.qaB.id}`).expect(200)).body;
    const oneList = (await get(f.users.exec, `/tasks/team?overdue=Yes&all=true&assigneeUserId=${f.users.qaB.id}`).expect(200)).body;
    expect(oneList.total).toBe(one.statCounts.overdue);
    expect(idsOf(oneList.tasks)).toEqual(pick('qaPersonOverdue'));
  });

  it('Overdue: a PM wait that pushes the effective due date out is not overdue', async () => {
    await ds.query(`UPDATE project_tasks SET "pmWaitWorkingDays" = 100000 WHERE id = $1`, [ids.pmFeedbackOverdue]);
    try {
      const card = (await get(f.users.pm, '/tasks/team?pageSize=1').expect(200)).body;
      const list = (await get(f.users.pm, '/tasks/team?overdue=Yes&all=true').expect(200)).body;
      expect(list.total).toBe(card.statCounts.overdue);
      expect(idsOf(list.tasks)).not.toContain(ids.pmFeedbackOverdue);
    } finally {
      await ds.query(`UPDATE project_tasks SET "pmWaitWorkingDays" = 0 WHERE id = $1`, [ids.pmFeedbackOverdue]);
    }
  });

  it('Passed testing: statCounts.passed equals the list - Pass + Released, completedAt in the period, assigned only', async () => {
    const q = 'passedFrom=2026-10-01&passedTo=2026-10-31';
    const res = (await get(f.users.pm, `/tasks/team?${q}&pageSize=1`).expect(200)).body;
    const list = (await get(f.users.pm, `/tasks/team?${q}&all=true`).expect(200)).body;
    const expected = pick('pastPass', 'pastReleased', 'releasedWith', 'qaPersonPass', 'defectPass');
    expect(res.statCounts.passed).toBe(expected.length);
    expect(list.total).toBe(res.statCounts.passed);
    expect(idsOf(list.tasks)).toEqual(expected);
    // Not set without a period, so it can't be mistaken for one.
    const plain = (await get(f.users.pm, '/tasks/team?pageSize=1').expect(200)).body;
    expect(plain.statCounts.passed).toBeUndefined();
  });

  it('Passed testing: a status tab narrows within the passed rows, never outside them', async () => {
    const q = 'passedFrom=2026-10-01&passedTo=2026-10-31&all=true';
    const pass = (await get(f.users.exec, `/tasks/team?${q}&status=Pass`).expect(200)).body;
    expect(idsOf(pass.tasks)).toEqual(pick('pastPass', 'qaPersonPass', 'defectPass'));
    const dev = (await get(f.users.exec, `/tasks/team?${q}&status=Development`).expect(200)).body;
    expect(dev.total).toBe(0);
  });

  it('Passed testing: one-sided ranges work and bad dates are refused', async () => {
    const from = (await get(f.users.pm, '/tasks/team?passedFrom=2026-11-01&all=true').expect(200)).body;
    expect(idsOf(from.tasks)).toEqual(pick('passNovember'));
    expect(from.statCounts.passed).toBe(1);
    const to = (await get(f.users.pm, '/tasks/team?passedTo=2026-09-30&all=true').expect(200)).body;
    expect(idsOf(to.tasks)).toEqual(pick('passSeptember'));
    await get(f.users.pm, '/tasks/team?passedFrom=2026-13-45').expect(400);
    await get(f.users.pm, '/tasks/team?passedTo=yesterday').expect(400);
  });

  it('Hold is counted on its own and is never part of the open counts', async () => {
    const res = (await get(f.users.pm, '/tasks/team?pageSize=1').expect(200)).body;
    expect(res.statCounts.hold).toBe(2); // past Hold + defectHold
    const hold = (await get(f.users.pm, '/tasks/team?status=Hold&all=true').expect(200)).body;
    expect(hold.total).toBe(res.statCounts.hold);
  });

  it('Open defects (PM/Admin): statCounts.pending equals the list - every open status, assigned or not, no Hold', async () => {
    const expected = pick('defectDev', 'defectFeedback', 'defectReFeedback', 'defectFailed', 'defectNotReady', 'defectDisputed', 'defectUnassigned', 'defectByPm');
    for (const u of [f.users.pm, f.users.admin]) {
      const res = (await get(u, '/tasks/defect-queue').expect(200)).body;
      expect(res.statCounts.pending).toBe(res.tasks.length);
      expect(idsOf(res.tasks)).toEqual(expected);
    }
  });

  it('Open defects (QA): only the defects that QA raised, same count as the list', async () => {
    const res = (await get(f.users.qaB, '/tasks/defect-queue').expect(200)).body;
    expect(res.statCounts.pending).toBe(res.tasks.length);
    expect(idsOf(res.tasks)).toEqual(
      pick('defectDev', 'defectFeedback', 'defectReFeedback', 'defectFailed', 'defectNotReady', 'defectDisputed', 'defectUnassigned'),
    );
    const failed = (await get(f.users.qaB, '/tasks/defect-queue?status=Failed').expect(200)).body;
    expect(idsOf(failed.tasks)).toEqual(pick('defectFailed'));
  });

  it('Awaiting QA: qa-queue?include=defects pending equals its list for PM, QA and Executive', async () => {
    for (const u of [f.users.pm, f.users.qaB, f.users.exec]) {
      const res = (await get(u, '/tasks/qa-queue?include=defects').expect(200)).body;
      expect(res.statCounts.pending).toBe(res.tasks.length);
      const re = (await get(u, '/tasks/qa-queue?include=defects&status=Re-Feedback').expect(200)).body;
      expect(re.tasks.length).toBe(res.statCounts.resubmissions);
    }
    const pm = (await get(f.users.pm, '/tasks/qa-queue?include=defects').expect(200)).body;
    expect(idsOf(pm.tasks)).toEqual(pick('past Feedback', 'past Re-Feedback', 'defectFeedback', 'defectReFeedback'));
    // Executive can't see the defect queue, so defects are left out of both.
    const exec = (await get(f.users.exec, '/tasks/qa-queue?include=defects').expect(200)).body;
    expect(idsOf(exec.tasks)).toEqual(pick('past Feedback', 'past Re-Feedback'));
  });

  it('Team scope never reaches another tenant', async () => {
    const list = (await get(f.users.pm, '/tasks/team?overdue=Yes&all=true').expect(200)).body;
    expect(idsOf(list.tasks)).not.toContain(ids.otherTenantOverdue);
  });
});
