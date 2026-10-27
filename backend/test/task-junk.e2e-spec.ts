import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { KpiService } from '../src/kpi/kpi.service';
import { NonComplianceReportService } from '../src/non-compliance-report/non-compliance-report.service';
import { TasksService } from '../src/tasks/tasks.service';

// Junk state (2026-10-09): Program Manager marks tickets created by
// mistake as Junk (with a reason, in bulk), which hides them from
// Developer/QA everywhere and from every count and measure, and can
// restore them to exactly where they were. Nothing is deleted and every
// mark/restore is in the audit trail.
describe('Task Junk (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;
  const PAST = '2026-10-05'; // a Monday, before "today" - due then means overdue
  const ids: Record<string, number> = {};
  let ticketId: number;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const statusOf = async (id: number) => (await ds.query(`SELECT * FROM project_tasks WHERE id = $1`, [id]))[0];

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

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_blocking_defects, user_notifications, audit_logs, kpi_period_score RESTART IDENTITY CASCADE`);
    phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;

    await task('qa', { status: 'Feedback', dueDate: PAST, qaReviewDueDate: PAST, title: 'Zebra mistake in QA' });
    await task('dev', { status: 'Development', dueDate: PAST });
    await task('keep', { status: 'Development', dueDate: PAST, title: 'Real work stays' });
    await task('held', { status: 'Hold', priorStatus: 'Feedback', dueDate: PAST });
    await task('defect', {
      status: 'Development',
      isDefect: true,
      parentTaskId: null,
      createdByUserId: f.users.qaB.id,
      createdByEmail: f.users.qaB.email,
    });
    await task('esc', { status: 'Escalated', dueDate: PAST });
    // qaB's only due task - once Junk, qaB must get no KPI row at all.
    await task('solo', { status: 'Development', dueDate: PAST, assigneeUserId: f.users.qaB.id, assigneeEmail: f.users.qaB.email });
    // devNone's own real task, so devNone has a KPI row whose outbound
    // dependency penalty (the open ticket on 'dev', past due) is visible.
    await task('control', { status: 'Development', dueDate: PAST, assigneeUserId: f.users.devNone.id, assigneeEmail: f.users.devNone.email });
    await ds.query(`UPDATE project_tasks SET "parentTaskId" = $1 WHERE id = $2`, [ids.keep, ids.defect]);

    await ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", "resolution", "submittedByUserId", "submittedByEmail", "submittedAt", "status", "reviewType")
       VALUES ($1, $2, 1, 'done', $3, $4, now(), 'pending', 'qa')`,
      [f.tenants.t1, ids.qa, f.users.devA.id, f.users.devA.email],
    );
    ticketId = (
      await ds.query(
        `INSERT INTO task_dependency_tickets ("tenantId", "parentTaskId", "title", "description", "ownerUserId", "ownerEmail", "createdByUserId", "createdByEmail", "status")
         VALUES ($1, $2, 'Need API', 'x', $3, $4, $5, $6, 'open') RETURNING id`,
        [f.tenants.t1, ids.dev, f.users.devNone.id, f.users.devNone.email, f.users.devA.id, f.users.devA.email],
      )
    )[0].id;
    await ds.query(
      `INSERT INTO user_notifications ("tenantId", "userId", "type", "title", "link") VALUES ($1, $2, 'task.assigned', 'Assigned', $3), ($1, $2, 'task.assigned', 'Assigned', $4)`,
      [f.tenants.t1, f.users.devA.id, `/tasks/${ids.qa}`, `/tasks/${ids.keep}`],
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  const toMark = () => [ids.qa, ids.dev, ids.held, ids.defect, ids.solo];

  describe('before anything is junked', () => {
    it('the tickets are visible and counted', async () => {
      const mine = (await get(f.users.devA, '/tasks/mine').expect(200)).body.map((t: any) => t.id);
      expect(mine).toEqual(expect.arrayContaining([ids.qa, ids.dev, ids.held, ids.keep]));
      const queue = (await get(f.users.qaB, '/tasks/qa-queue').expect(200)).body;
      expect(queue.tasks.map((t: any) => t.id)).toContain(ids.qa);
      expect(queue.statCounts.pending).toBe(1);
      await get(f.users.qaB, `/tasks/${ids.qa}`).expect(200);
      expect((await get(f.users.devA, '/notifications/unread-count').expect(200)).body.count).toBe(2);
      expect((await get(f.users.devNone, '/task-dependency-tickets/mine').expect(200)).body.map((t: any) => t.id)).toEqual([ticketId]);
    });
  });

  const kpiRows = async () => {
    return app.get(KpiService).generatePeriod('daily', new Date(`${PAST}T12:00:00`), f.tenants.t1);
  };

  it('KPI before: the tickets are due/overdue and the open dependency counts against its owner', async () => {
    const rows = await kpiRows();
    expect(rows.find((r) => r.assigneeUserId === f.users.devA.id)!.ticketsDue).toBe(4); // qa, dev, keep, esc
    expect(rows.find((r) => r.assigneeUserId === f.users.qaB.id)!.ticketsDue).toBe(1);
    expect(Number(rows.find((r) => r.assigneeUserId === f.users.devNone.id)!.outboundDependencyOverduePercent)).toBe(100);
  });

  describe('who can mark', () => {
    it('only Program Manager - Admin, Executive, Developer and QA are refused', async () => {
      for (const u of [f.users.admin, f.users.exec, f.users.devA, f.users.qaB]) {
        await patch(u, '/tasks/bulk-junk', { taskIds: [ids.dev], reason: 'Created by mistake' }).expect(403);
        await patch(u, `/tasks/${ids.dev}/junk`, { reason: 'Created by mistake' }).expect(403);
      }
      expect((await statusOf(ids.dev)).status).toBe('Development');
    });

    it('a reason is required', async () => {
      await patch(f.users.pm, '/tasks/bulk-junk', { taskIds: [ids.dev] }).expect(400);
      await patch(f.users.pm, '/tasks/bulk-junk', { taskIds: [ids.dev], reason: '   ' }).expect(400);
      await patch(f.users.pm, `/tasks/${ids.dev}/junk`, { reason: '' }).expect(400);
      expect((await statusOf(ids.dev)).status).toBe('Development');
    });

    it('is all-or-nothing: one bad id changes nothing', async () => {
      await patch(f.users.pm, '/tasks/bulk-junk', { taskIds: [ids.qa, ids.dev, 999999], reason: 'Created by mistake' }).expect(404);
      expect((await statusOf(ids.qa)).status).toBe('Feedback');
      expect((await statusOf(ids.dev)).status).toBe('Development');
      expect((await ds.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'task_marked_junk'`))[0].n).toBe(0);
    });
  });

  describe('PM marks five tickets at once', () => {
    beforeAll(async () => {
      const res = await patch(f.users.pm, '/tasks/bulk-junk', { taskIds: toMark(), reason: '  Created by mistake  ' }).expect(200);
      expect(res.body.map((t: any) => t.id)).toEqual([...toMark()].sort((a, b) => a - b));
    });

    it('records who, when, why and the previous status, keeping Hold\'s own resume point', async () => {
      const qa = await statusOf(ids.qa);
      expect(qa).toMatchObject({ status: 'Junk', statusBeforeJunk: 'Feedback', junkReason: 'Created by mistake', junkedByUserId: f.users.pm.id, junkedByEmail: f.users.pm.email });
      expect(qa.junkedAt).toBeTruthy();
      expect(await statusOf(ids.held)).toMatchObject({ status: 'Junk', statusBeforeJunk: 'Hold', priorStatus: 'Feedback' });
    });

    it('writes one audit entry per ticket with reason and old -> new status', async () => {
      const rows = await ds.query(`SELECT * FROM audit_logs WHERE action = 'task_marked_junk' ORDER BY "entityId"`);
      expect(rows.map((r: any) => r.entityId)).toEqual([...toMark()].sort((a, b) => a - b));
      const qaRow = rows.find((r: any) => r.entityId === ids.qa);
      expect(qaRow).toMatchObject({ userId: f.users.pm.id, userEmail: f.users.pm.email, entityType: 'ProjectTask' });
      expect(JSON.parse(qaRow.details)).toMatchObject({ reason: 'Created by mistake', previousStatus: 'Feedback', newStatus: 'Junk', source: 'bulk', batchSize: 5 });
    });

    it('marking an already-Junk ticket again is refused and changes nothing', async () => {
      await patch(f.users.pm, '/tasks/bulk-junk', { taskIds: [ids.keep, ids.qa], reason: 'again' }).expect(400);
      expect((await statusOf(ids.keep)).status).toBe('Development');
    });

    it('hides them from the Developer: My Tasks, All Tasks, task page, search, bell, dependency cards', async () => {
      const mine = (await get(f.users.devA, '/tasks/mine').expect(200)).body.map((t: any) => t.id);
      expect(mine).toEqual(expect.arrayContaining([ids.keep, ids.esc]));
      for (const id of toMark()) expect(mine).not.toContain(id);
      const all = (await get(f.users.devA, '/tasks').expect(200)).body.map((t: any) => t.id);
      for (const id of toMark()) expect(all).not.toContain(id);
      for (const id of toMark()) await get(f.users.devA, `/tasks/${id}`).expect(403);
      const search = (await get(f.users.devA, '/search?q=Zebra').expect(200)).body;
      expect(search.tasks).toEqual([]);
      const bell = (await get(f.users.devA, '/notifications').expect(200)).body.map((n: any) => n.link);
      expect(bell).toEqual([`/tasks/${ids.keep}`]);
      expect((await get(f.users.devA, '/notifications/unread-count').expect(200)).body.count).toBe(1);
      expect((await get(f.users.devNone, '/task-dependency-tickets/mine').expect(200)).body).toEqual([]);
      expect((await get(f.users.devA, '/task-dependency-tickets/created-by-me').expect(200)).body).toEqual([]);
      expect((await get(f.users.devA, `/tasks/${ids.keep}/linked-defects`).expect(200)).body).toEqual([]);
    });

    it('hides them from QA: QA queue and its counts, defect queue, task page', async () => {
      const queue = (await get(f.users.qaB, '/tasks/qa-queue').expect(200)).body;
      expect(queue.tasks).toEqual([]);
      expect(queue.statCounts).toMatchObject({ pending: 0, overdue: 0 });
      const defects = (await get(f.users.qaB, '/tasks/defect-queue').expect(200)).body;
      expect(defects.tasks).toEqual([]);
      expect(defects.statCounts.pending).toBe(0);
      await get(f.users.qaB, `/tasks/${ids.qa}`).expect(403);
      await get(f.users.qaB, `/tasks/${ids.defect}`).expect(403);
    });

    it('refuses every action on a Junk ticket', async () => {
      await patch(f.users.devA, `/tasks/${ids.dev}`, { estimatedHours: 3 }).expect(400);
      await patch(f.users.qaB, `/tasks/${ids.qa}/qa-escalate`, { comment: 'x' }).expect(400);
      await patch(f.users.pm, `/tasks/${ids.dev}/hold`).expect(400);
      await patch(f.users.pm, `/tasks/${ids.dev}/close`).expect(400);
      await patch(f.users.pm, `/tasks/${ids.dev}/assign`, { assigneeUserId: f.users.devNone.id }).expect(400);
      await http()
        .post('/task-dependency-tickets')
        .set(auth(f.users.devA))
        .send({ parentTaskId: ids.dev, ownerUserId: f.users.devNone.id, title: 'x', description: 'y' })
        .expect((r) => expect([400, 403]).toContain(r.status));
      expect((await statusOf(ids.dev)).status).toBe('Junk');
    });

    it('a Junk defect no longer blocks its parent task', async () => {
      await expect(app.get(TasksService).assertNoOpenLinkedDefects(ids.keep, f.tenants.t1)).resolves.toBeUndefined();
    });

    it('Team Tasks never shows or counts Junk, whatever the toggles or status filter', async () => {
      for (const qs of ['', '?showCompleted=true&showHoldClosed=true', '?status=Junk', '?status=Junk,Feedback,Development']) {
        const res = (await get(f.users.pm, `/tasks/team${qs}`).expect(200)).body;
        const shown = res.tasks.map((t: any) => t.id);
        for (const id of toMark()) expect(shown).not.toContain(id);
        expect(res.dependenciesToClearCount).toBe(0);
      }
      const cards = (await get(f.users.pm, '/tasks/team?showCompleted=true&showHoldClosed=true').expect(200)).body.statCounts;
      expect(cards).toMatchObject({ total: 3, defects: 0, openDependency: 0 });
    });

    it('Status Review leaves them out of every bucket and total', async () => {
      const sr = (await get(f.users.pm, '/status-review').expect(200)).body;
      expect(JSON.stringify(sr.records)).not.toContain('Zebra');
      expect(sr.totals).toMatchObject({ qa: 0, development: 2, intervention: 1, workItems: 3, toClear: 0 });
    });

    it('KPI: Junk tickets are not due, overdue or a dependency penalty, and create no rows on their own', async () => {
        const rows = await kpiRows();
        expect(rows.find((r) => r.assigneeUserId === f.users.devA.id)!.ticketsDue).toBe(2); // keep + esc
      expect(rows.find((r) => r.assigneeUserId === f.users.qaB.id)).toBeUndefined();
      expect(Number(rows.find((r) => r.assigneeUserId === f.users.devNone.id)!.outboundDependencyOverduePercent)).toBe(0);
    });

    it('Non-compliance report: no Late to QA item for a Junk ticket', async () => {
      const report: any = await app.get(NonComplianceReportService).computeReport(f.tenants.t1, f.projects.pA, '2026-10-01', '2026-10-31');
      const devA = report.developers.find((d: any) => d.userId === f.users.devA.id);
      const missed = devA.lateToQa.items.map((i: any) => i.taskId);
      for (const id of toMark()) expect(missed).not.toContain(id);
      expect(missed).toContain(ids.keep);
    });

    it('Backlog never shows Junk', async () => {
      await ds.query(`UPDATE project_tasks SET "assigneeUserId" = NULL WHERE id = $1`, [ids.dev]);
      for (const qs of ['', '?showHoldClosed=true']) {
        expect((await get(f.users.pm, `/tasks/backlog${qs}`).expect(200)).body.map((t: any) => t.id)).not.toContain(ids.dev);
      }
      await ds.query(`UPDATE project_tasks SET "assigneeUserId" = $1 WHERE id = $2`, [f.users.devA.id, ids.dev]);
    });
  });

  describe('Junk list', () => {
    it('PM and Admin see who, when, why and the previous status; Executive, Developer, QA cannot', async () => {
      for (const u of [f.users.pm, f.users.admin]) {
        const list = (await get(u, '/tasks/junk').expect(200)).body;
        expect(list.map((t: any) => t.id).sort()).toEqual([...toMark()].sort());
        expect(list.find((t: any) => t.id === ids.qa)).toMatchObject({ junkReason: 'Created by mistake', junkedByEmail: f.users.pm.email, statusBeforeJunk: 'Feedback' });
      }
      for (const u of [f.users.exec, f.users.devA, f.users.qaB]) await get(u, '/tasks/junk').expect(403);
    });

    it('leadership can still open the ticket and its junk history', async () => {
      await get(f.users.pm, `/tasks/${ids.qa}`).expect(200);
      const history = (await get(f.users.admin, `/tasks/${ids.qa}/junk-history`).expect(200)).body;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ action: 'task_marked_junk', userEmail: f.users.pm.email, details: { reason: 'Created by mistake', previousStatus: 'Feedback' } });
      await get(f.users.devA, `/tasks/${ids.qa}/junk-history`).expect(403);
    });
  });

  describe('Restore', () => {
    it('only Program Manager, and only a Junk ticket', async () => {
      for (const u of [f.users.admin, f.users.exec, f.users.devA, f.users.qaB]) await patch(u, `/tasks/${ids.qa}/restore-junk`).expect(403);
      await patch(f.users.pm, `/tasks/${ids.keep}/restore-junk`).expect(400);
    });

    it('returns a QA ticket to its status and the QA queue, history intact, and it counts again', async () => {
      const restored = (await patch(f.users.pm, `/tasks/${ids.qa}/restore-junk`).expect(200)).body;
      expect(restored).toMatchObject({ status: 'Feedback', statusBeforeJunk: null, junkReason: null, junkedAt: null, junkedByEmail: null });
      const queue = (await get(f.users.qaB, '/tasks/qa-queue').expect(200)).body;
      expect(queue.tasks.map((t: any) => t.id)).toEqual([ids.qa]);
      expect(queue.statCounts.pending).toBe(1);
      expect((await ds.query(`SELECT count(*)::int n FROM task_qa_reviews WHERE "taskId" = $1`, [ids.qa]))[0].n).toBe(1);
      expect((await get(f.users.devA, '/tasks/mine').expect(200)).body.map((t: any) => t.id)).toContain(ids.qa);
      expect((await get(f.users.devA, '/notifications/unread-count').expect(200)).body.count).toBe(2);
      const audit = await ds.query(`SELECT * FROM audit_logs WHERE action = 'task_restored_from_junk' AND "entityId" = $1`, [ids.qa]);
      expect(audit).toHaveLength(1);
      expect(JSON.parse(audit[0].details)).toEqual({ reason: 'Created by mistake', previousStatus: 'Junk', newStatus: 'Feedback' });
      const history = (await get(f.users.pm, `/tasks/${ids.qa}/junk-history`).expect(200)).body.map((h: any) => h.action);
      expect(history).toEqual(['task_marked_junk', 'task_restored_from_junk']);
    });

    it('returns a Held ticket to Hold, still resuming to where it was before Hold', async () => {
      await patch(f.users.pm, `/tasks/${ids.held}/restore-junk`).expect(200);
      expect(await statusOf(ids.held)).toMatchObject({ status: 'Hold', priorStatus: 'Feedback', statusBeforeJunk: null });
      await patch(f.users.pm, `/tasks/${ids.held}/release`).expect(200);
      expect((await statusOf(ids.held)).status).toBe('Feedback');
    });

    it('brings dependency tickets back with their task', async () => {
      await patch(f.users.pm, `/tasks/${ids.dev}/restore-junk`).expect(200);
      expect((await get(f.users.devNone, '/task-dependency-tickets/mine').expect(200)).body.map((t: any) => t.id)).toEqual([ticketId]);
      expect((await get(f.users.pm, '/tasks/team').expect(200)).body.dependenciesToClearCount).toBe(1);
    });

    it('restoring twice is refused', async () => {
      await patch(f.users.pm, `/tasks/${ids.qa}/restore-junk`).expect(400);
    });
  });

  describe('Close as Junk from Interventions', () => {
    it('now needs a reason, and can be restored to Escalated', async () => {
      await patch(f.users.pm, `/tasks/${ids.esc}/escalation-junk`, {}).expect(400);
      await patch(f.users.admin, `/tasks/${ids.esc}/escalation-junk`, { reason: 'Not a real issue' }).expect(403);
      await patch(f.users.pm, `/tasks/${ids.esc}/escalation-junk`, { reason: 'Not a real issue' }).expect(200);
      expect(await statusOf(ids.esc)).toMatchObject({ status: 'Junk', statusBeforeJunk: 'Escalated', junkReason: 'Not a real issue' });
      expect((await get(f.users.pm, '/tasks/escalations').expect(200)).body).toEqual([]);
      await patch(f.users.pm, `/tasks/${ids.esc}/restore-junk`).expect(200);
      expect((await get(f.users.pm, '/tasks/escalations').expect(200)).body.map((t: any) => t.id)).toEqual([ids.esc]);
    });
  });

  describe('migration backfill of older escalation-Junk tickets', () => {
    it('fills who/when from the audit entry and sets Escalated as the restore target', async () => {
      await task('legacy', { status: 'Junk' });
      await task('legacyNoAudit', { status: 'Junk' });
      await ds.query(
        `INSERT INTO audit_logs ("tenantId", "userId", "userEmail", "action", "entityType", "entityId", "createdAt") VALUES ($1, $2, $3, 'task_escalation_closed_junk', 'ProjectTask', $4, '2026-09-20 10:00')`,
        [f.tenants.t1, f.users.pm.id, f.users.pm.email, ids.legacy],
      );
      const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-10-task-junk.sql'), 'utf8');
      const backfill = sql.slice(sql.indexOf('UPDATE'), sql.lastIndexOf('COMMIT;'));
      await ds.query(backfill);
      expect(await statusOf(ids.legacy)).toMatchObject({ statusBeforeJunk: 'Escalated', junkedByUserId: f.users.pm.id, junkedByEmail: f.users.pm.email });
      expect((await statusOf(ids.legacy)).junkReason).toMatch(/no reason was recorded/);
      expect(await statusOf(ids.legacyNoAudit)).toMatchObject({ statusBeforeJunk: 'Escalated', junkedByUserId: null });
      await patch(f.users.pm, `/tasks/${ids.legacy}/restore-junk`).expect(200);
      expect((await statusOf(ids.legacy)).status).toBe('Escalated');
    });
  });
});
