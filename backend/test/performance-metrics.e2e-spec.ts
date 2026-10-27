import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { AuditLogService } from '../src/audit/audit-log.service';

// Performance metrics (2026-10-27): every assignment / Due date audit
// entry also writes a task_commitment_events row as it happens; the
// backfill script makes exactly the same rows from the audit log; the
// report and settings follow the agreed role rules.
describe('Performance metrics (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let taskId: number;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const post = (u: FixtureUser, url: string, body: any = {}) => http().post(url).set(auth(u)).send(body);
  const events = () =>
    ds.query(
      `SELECT "tenantId", "taskId", kind, "assigneeUserId", "previousAssigneeUserId", "actorUserId", "actorRole", "occurredAt",
              "oldDueDate"::text, "newDueDate"::text, direction, "auditLogId", source
       FROM task_commitment_events ORDER BY "auditLogId"`,
    );
  const BACKFILL = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-10-performance-metrics-backfill.sql'), 'utf8');

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, audit_logs, task_commitment_events, performance_metric_settings, performance_holidays RESTART IDENTITY CASCADE`,
    );
    const phaseId = (
      await ds.query(
        `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA],
      )
    )[0].id;
    taskId = (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "createdByUserId", "createdByEmail")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', 'Backlog task', 'x', 'Development', $5, $6) RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, f.users.pm.id, f.users.pm.email],
      )
    )[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('live recording', () => {
    it('records assignment, first Due date, each change and unassignment as they happen', async () => {
      await patch(f.users.pm, `/tasks/${taskId}/assign`, { assigneeUserId: f.users.devA.id }).expect(200);
      await patch(f.users.devA, `/tasks/${taskId}`, { dueDate: '2026-11-10' }).expect(200);
      await patch(f.users.pm, `/tasks/${taskId}`, { dueDate: '2026-11-20' }).expect(200);
      await patch(f.users.pm, `/tasks/${taskId}`, { dueDate: '2026-11-15' }).expect(200);
      // Saving without changing the date is not an event.
      await patch(f.users.pm, `/tasks/${taskId}`, { dueDate: '2026-11-15', title: 'Renamed' }).expect(200);
      await patch(f.users.pm, `/tasks/${taskId}/reassign`, { assigneeUserId: null }).expect(200);

      const rows = await events();
      expect(rows.map((r: any) => [r.kind, r.assigneeUserId, r.actorUserId, r.oldDueDate, r.newDueDate, r.direction, r.source])).toEqual([
        ['assigned', f.users.devA.id, f.users.pm.id, null, null, null, 'live'],
        ['due_set', f.users.devA.id, f.users.devA.id, null, '2026-11-10', null, 'live'],
        ['due_changed', f.users.devA.id, f.users.pm.id, '2026-11-10', '2026-11-20', 'later', 'live'],
        ['due_changed', f.users.devA.id, f.users.pm.id, '2026-11-20', '2026-11-15', 'earlier', 'live'],
        ['unassigned', null, f.users.pm.id, null, null, null, 'live'],
      ]);
      expect(rows[4].previousAssigneeUserId).toBe(f.users.devA.id);
      // Each row is tied to its audit entry and carries its time.
      const audit = await ds.query(`SELECT id, "createdAt" FROM audit_logs WHERE id = ANY($1)`, [rows.map((r: any) => r.auditLogId)]);
      expect(audit).toHaveLength(5);
      for (const r of rows) expect(new Date(r.occurredAt).getTime()).toBe(new Date(audit.find((a: any) => a.id === r.auditLogId).createdAt).getTime());
    });

    it('records within a caller transaction too (PM send-back with reassign)', async () => {
      const audit = app.get(AuditLogService);
      await ds.transaction((em) =>
        audit.recordWithin(em, {
          userId: f.users.pm.id,
          userEmail: f.users.pm.email,
          userRole: 'program_manager',
          action: 'task_reassigned',
          tenantId: f.tenants.t1,
          entityType: 'ProjectTask',
          entityId: taskId,
          details: { previousAssigneeUserId: null, assigneeUserId: f.users.devA.id, source: 'pm-send-back-from-qa' },
        }),
      );
      const rows = await events();
      expect(rows[rows.length - 1]).toMatchObject({ kind: 'assigned', assigneeUserId: f.users.devA.id, source: 'live' });
    });
  });

  describe('backfill', () => {
    it('makes exactly the same rows from the audit log, marked reconstructed, and can run again', async () => {
      const live = await events();
      await ds.query(`DELETE FROM task_commitment_events`);
      await ds.query(BACKFILL);
      const rebuilt = await events();
      const strip = (rows: any[]) => rows.map(({ source, ...rest }: any) => rest);
      expect(strip(rebuilt)).toEqual(strip(live));
      expect(rebuilt.every((r: any) => r.source === 'reconstructed')).toBe(true);
      await ds.query(BACKFILL);
      expect(await events()).toHaveLength(live.length);
    });
  });

  describe('report and roles', () => {
    it('PM, Executive and Admin see everyone; a developer only themselves; others 403', async () => {
      for (const u of [f.users.pm, f.users.exec, f.users.admin]) {
        const body = (await get(u, '/performance-metrics').expect(200)).body;
        expect(body.people.map((p: any) => p.userId)).toEqual(expect.arrayContaining([f.users.devA.id, f.users.devNone.id]));
        expect(body.history.startsOn).not.toBeNull();
        expect(body.settings.onTimeOkPercent).toBe(90);
      }
      const mine = (await get(f.users.devA, '/performance-metrics').expect(200)).body;
      expect(mine.people.map((p: any) => p.userId)).toEqual([f.users.devA.id]);
      await get(f.users.qaB, '/performance-metrics').expect(403);
      await get(f.users.clientA, '/performance-metrics').expect(403);
      await get(f.users.pm, '/performance-metrics?to=yesterday').expect(400);
    });

    it('shows the Due date changes in the drill-down', async () => {
      const body = (await get(f.users.pm, `/performance-metrics?to=${new Date().toISOString().slice(0, 10)}`).expect(200)).body;
      const devA = body.people.find((p: any) => p.userId === f.users.devA.id);
      expect(devA.dueChanges).toMatchObject({ changes: 2, later: 1, earlier: 1 });
      expect(devA.dueChanges.items[0]).toMatchObject({ taskId, oldDueDate: '2026-11-10', newDueDate: '2026-11-20', byUserId: f.users.pm.id });
    });
  });

  describe('settings and holidays', () => {
    it('only Admin and PM can change settings; every change is audited and validated', async () => {
      await patch(f.users.devA, '/performance-metrics/settings', { minSample: 3 }).expect(403);
      await patch(f.users.exec, '/performance-metrics/settings', { minSample: 3 }).expect(403);
      await patch(f.users.pm, '/performance-metrics/settings', { timeZone: 'Mars/Base' }).expect(400);
      await patch(f.users.pm, '/performance-metrics/settings', { weekendDays: [0, 1, 2, 3, 4, 5, 6] }).expect(400);
      const saved = (await patch(f.users.pm, '/performance-metrics/settings', { minSample: 3, onTimeOkPercent: 85, excludedStatuses: ['Junk'] }).expect(200)).body;
      expect(saved).toMatchObject({ minSample: 3, onTimeOkPercent: 85, excludedStatuses: ['Junk'], qaAcceptanceOkPercent: 75, isDefault: false });
      const audit = await ds.query(`SELECT details FROM audit_logs WHERE action = 'performance_metric_settings_updated'`);
      expect(JSON.parse(audit[0].details)).toMatchObject({ before: { minSample: 5 }, after: { minSample: 3 } });
      expect((await get(f.users.devA, '/performance-metrics/settings').expect(200)).body.minSample).toBe(3);
    });

    it('holidays: added and removed by Admin/PM, audited, no duplicates', async () => {
      await post(f.users.exec, '/performance-metrics/holidays', { date: '2027-01-07', name: 'Genna' }).expect(403);
      await post(f.users.pm, '/performance-metrics/holidays', { date: '2027-02-30', name: 'Bad' }).expect(400);
      const h = (await post(f.users.pm, '/performance-metrics/holidays', { date: '2027-01-07', name: 'Genna' }).expect(201)).body;
      await post(f.users.admin, '/performance-metrics/holidays', { date: '2027-01-07', name: 'Again' }).expect(409);
      expect((await get(f.users.devA, '/performance-metrics/holidays').expect(200)).body.map((x: any) => x.date)).toEqual(['2027-01-07']);
      await http().delete(`/performance-metrics/holidays/${h.id}`).set(auth(f.users.devA)).expect(403);
      await http().delete(`/performance-metrics/holidays/${h.id}`).set(auth(f.users.admin)).expect(200);
      const audit = await ds.query(`SELECT action FROM audit_logs WHERE action LIKE 'performance_holiday_%' ORDER BY id`);
      expect(audit.map((a: any) => a.action)).toEqual(['performance_holiday_added', 'performance_holiday_removed']);
    });
  });
});
