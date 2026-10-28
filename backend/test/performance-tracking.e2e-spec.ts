import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { AuditActions, AuditLogService } from '../src/audit/audit-log.service';
import { DEFECT_TRIAGE_AUDIT } from '../src/tasks/defect-triage';
import { RETURN_TO_QA_AUDIT } from '../src/tasks/return-to-qa';
import { QA_INTAKE_AUDIT } from '../src/tasks/qa-intake';
import { PERFORMANCE_TRACKING_DEFAULTS, STATUS_EVENT_AUDIT_ACTIONS, projectTrackingPhase } from '../src/performance-tracking/performance-tracking';

// Performance Tracking S1 (2026-10-28): the status event log is written by
// database triggers for every status change, whatever the code path, with
// the actor taken from the action's audit entry; the history rebuilt from
// audit_logs matches what is recorded live; settings and the per-project
// switch are Admin + PM only, OFF by default, with a 4-week Baseline.
describe('Performance tracking S1 (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let phaseId: number;

  const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-10-performance-tracking-foundation.sql'), 'utf8');
  // The history part of the migration on its own.
  const BACKFILL = MIGRATION.slice(MIGRATION.indexOf('WITH src AS ('), MIGRATION.lastIndexOf('COMMIT;'));

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const events = (taskId: number) =>
    ds.query(
      `SELECT "fromStatus", "toStatus", "actorUserId", "actorRole", action, "auditLogId", source, "occurredAt"
       FROM task_status_events WHERE "taskId" = $1 ORDER BY "occurredAt", id`,
      [taskId],
    );
  const newTask = async (title: string) =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', $5, 'x', 'Development', $6, $7, $8, $9) RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, title, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, audit_logs, task_status_events, performance_tracking_settings RESTART IDENTITY CASCADE`);
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

  describe('status event log', () => {
    let taskId: number;

    it('records creation, then each status change with who did it; field edits are not events', async () => {
      taskId = await newTask('Status log task');
      await patch(f.users.pm, `/tasks/${taskId}/hold`).expect(200);
      await patch(f.users.admin, `/tasks/${taskId}/release`).expect(200);
      await patch(f.users.pm, `/tasks/${taskId}`, { title: 'Renamed' }).expect(200);
      await patch(f.users.pm, `/tasks/${taskId}/close`).expect(200);
      await patch(f.users.pm, `/tasks/${taskId}/reopen`).expect(200);
      // Junk writes its audit entry inside the same transaction.
      await patch(f.users.pm, `/tasks/${taskId}/junk`, { reason: 'Created by mistake for the test' }).expect(200);
      await patch(f.users.pm, `/tasks/${taskId}/restore-junk`).expect(200);

      const rows = await events(taskId);
      expect(rows.map((r: any) => [r.fromStatus, r.toStatus, r.actorUserId, r.action, r.source])).toEqual([
        [null, 'Development', f.users.pm.id, null, 'live'],
        ['Development', 'Hold', f.users.pm.id, 'task_held', 'live'],
        ['Hold', 'Development', f.users.admin.id, 'task_released_from_hold', 'live'],
        ['Development', 'Closed', f.users.pm.id, 'task_closed', 'live'],
        ['Closed', 'Development', f.users.pm.id, 'task_reopened', 'live'],
        ['Development', 'Junk', f.users.pm.id, 'task_marked_junk', 'live'],
        ['Junk', 'Development', f.users.pm.id, 'task_restored_from_junk', 'live'],
      ]);
      expect(rows[1].actorRole).toBe('program_manager');
      // Each linked event points at its own audit entry.
      const linked = rows.filter((r: any) => r.auditLogId != null);
      const audit = await ds.query(`SELECT id, action, "entityId" FROM audit_logs WHERE id = ANY($1)`, [linked.map((r: any) => r.auditLogId)]);
      for (const r of linked) expect(audit.find((a: any) => a.id === r.auditLogId)).toMatchObject({ action: r.action, entityId: taskId });
    });

    it('links an audit entry written BEFORE the change too (same transaction)', async () => {
      const audit = app.get(AuditLogService);
      await ds.transaction(async (em) => {
        await audit.recordWithin(em, {
          userId: f.users.admin.id,
          userEmail: f.users.admin.email,
          userRole: 'admin',
          action: 'task_status_changed',
          tenantId: f.tenants.t1,
          entityType: 'ProjectTask',
          entityId: taskId,
          details: { from: 'Development', to: 'Failed' },
        });
        await em.query(`UPDATE project_tasks SET status = 'Failed' WHERE id = $1`, [taskId]);
      });
      const last = (await events(taskId)).pop();
      expect(last).toMatchObject({ fromStatus: 'Development', toStatus: 'Failed', actorUserId: f.users.admin.id, action: 'task_status_changed' });
    });

    it('a change with no status audit entry is a system change (no actor), and a non-status audit entry does not claim it', async () => {
      await ds.query(`UPDATE project_tasks SET status = 'Development' WHERE id = $1`, [taskId]);
      await app.get(AuditLogService).record({
        userId: f.users.pm.id,
        userEmail: f.users.pm.email,
        userRole: 'program_manager',
        action: AuditActions.TASK_UPDATED,
        tenantId: f.tenants.t1,
        entityType: 'ProjectTask',
        entityId: taskId,
        details: { previous: {}, updated: {} },
      });
      const last = (await events(taskId)).pop();
      expect(last).toMatchObject({ fromStatus: 'Failed', toStatus: 'Development', actorUserId: null, action: null, auditLogId: null });
    });

    it('is fail-safe: if recording fails, the action and its audit entry still go through', async () => {
      // Occupy the id the next audit entry will get, so linking it breaks
      // the unique index.
      const next = Number((await ds.query(`SELECT last_value + 1 AS n FROM audit_logs_id_seq`))[0].n);
      await ds.query(
        `INSERT INTO task_status_events ("tenantId", "taskId", "toStatus", "occurredAt", "auditLogId", source) VALUES ($1, 999999, 'Pass', now(), $2, 'live')`,
        [f.tenants.t1, next],
      );
      await patch(f.users.pm, `/tasks/${taskId}/hold`).expect(200);
      expect((await ds.query(`SELECT action FROM audit_logs WHERE id = $1`, [next]))[0]).toEqual({ action: 'task_held' });
      expect((await events(taskId)).pop()).toMatchObject({ toStatus: 'Hold', auditLogId: null });
      await ds.query(`DELETE FROM task_status_events WHERE "taskId" = 999999`);
      // Link it by hand so the history comparison below stays exact.
      await ds.query(
        `UPDATE task_status_events SET "auditLogId" = $1, "actorUserId" = $2, "actorRole" = 'program_manager', action = 'task_held' WHERE "taskId" = $3 AND "toStatus" = 'Hold' AND "auditLogId" IS NULL`,
        [next, f.users.pm.id, taskId],
      );
      await patch(f.users.pm, `/tasks/${taskId}/release`).expect(200);
      expect((await events(taskId)).pop()).toMatchObject({ toStatus: 'Development', action: 'task_released_from_hold' });
    });

    it('an update that leaves the status alone writes nothing', async () => {
      const before = (await events(taskId)).length;
      await ds.query(`UPDATE project_tasks SET status = status, title = 'Again' WHERE id = $1`, [taskId]);
      expect(await events(taskId)).toHaveLength(before);
    });

    it('the history rebuilt from audit_logs matches what was recorded live', async () => {
      const live = (await events(taskId)).filter((r: any) => r.auditLogId != null || r.fromStatus == null);
      await ds.query(`DELETE FROM task_status_events`);
      await ds.query(BACKFILL);
      const rebuilt = await events(taskId);
      expect(rebuilt.every((r: any) => r.source === 'reconstructed')).toBe(true);
      const shape = (r: any) => [r.toStatus, r.actorUserId, r.auditLogId != null ? r.action : 'created'];
      expect(rebuilt.map(shape)).toEqual(live.map(shape));
      // fromStatus is the previous rebuilt event's status.
      expect(rebuilt[0].fromStatus).toBeNull();
      for (let i = 1; i < rebuilt.length; i++) expect(rebuilt[i].fromStatus).toBe(rebuilt[i - 1].toStatus);
    });

    it('a task created with no audit entry (bulk import) still gets its creation event', async () => {
      await ds.query(`DELETE FROM task_status_events`);
      await ds.query(BACKFILL);
      const rows = await events(taskId);
      expect(rows[0]).toMatchObject({ fromStatus: null, toStatus: 'Development', source: 'reconstructed' });
      const noAudit = await newTask('Imported');
      await ds.query(`DELETE FROM task_status_events`);
      await ds.query(BACKFILL);
      expect(await events(noAudit)).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'Development', actorUserId: f.users.pm.id, action: 'task_created', auditLogId: null })]);
    });

    it('the action list in the migration matches the code, and every action is a real one', () => {
      // The latest definition (S4 replaced S1's).
      const LATEST = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-10-performance-tracking-qa-intake.sql'), 'utf8');
      const start = LATEST.indexOf('CREATE OR REPLACE FUNCTION tracker_status_event_action');
      const sql = LATEST.slice(start, LATEST.indexOf('$$;', start));
      const inSql = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      expect([...inSql].sort()).toEqual([...STATUS_EVENT_AUDIT_ACTIONS].sort());
      const known = new Set<string>([...Object.values(AuditActions), ...Object.values(DEFECT_TRIAGE_AUDIT), ...Object.values(RETURN_TO_QA_AUDIT), ...Object.values(QA_INTAKE_AUDIT)]);
      expect(STATUS_EVENT_AUDIT_ACTIONS.filter((a) => !known.has(a))).toEqual([]);
    });
  });

  describe('settings and per-project switch', () => {
    it('Admin and PM only; everyone else 403', async () => {
      for (const u of [f.users.pm, f.users.admin]) await get(u, '/performance-tracking/settings').expect(200);
      for (const u of [f.users.exec, f.users.devA, f.users.qaB, f.users.clientA]) {
        await get(u, '/performance-tracking/settings').expect(403);
        await patch(u, '/performance-tracking/settings', { baselineDays: 7 }).expect(403);
        await patch(u, `/performance-tracking/projects/${f.projects.pA}`, { enabled: true }).expect(403);
      }
    });

    it('defaults, every project OFF', async () => {
      const body = (await get(f.users.pm, '/performance-tracking/settings').expect(200)).body;
      expect(body.settings).toEqual(PERFORMANCE_TRACKING_DEFAULTS);
      expect(body.isDefault).toBe(true);
      const mine = body.projects.filter((p: any) => [f.projects.pA, f.projects.pB].includes(p.id));
      expect(mine).toHaveLength(2);
      for (const p of mine) expect(p).toMatchObject({ performanceTrackingEnabled: false, performanceTrackingSince: null, phase: 'off' });
      // Another tenant's project is never listed.
      expect(body.projects.map((p: any) => p.id)).not.toContain(f.projects.pT2);
    });

    it('saves only what is sent, validates, and audits', async () => {
      await patch(f.users.pm, '/performance-tracking/settings', { baselineDays: -1 }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { chasesPerTasks: 0 }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { notReadyDeclaredDependencyExempt: 'yes' }).expect(400);
      const body = (await patch(f.users.pm, '/performance-tracking/settings', { notReadyDeclaredDependencyExempt: false, statusFreshWorkingDays: 3 }).expect(200)).body;
      expect(body.settings).toEqual({ ...PERFORMANCE_TRACKING_DEFAULTS, notReadyDeclaredDependencyExempt: false, statusFreshWorkingDays: 3 });
      expect(body.isDefault).toBe(false);
      const audit = await ds.query(`SELECT details FROM audit_logs WHERE action = 'performance_tracking_settings_updated'`);
      expect(audit).toHaveLength(1);
      expect(JSON.parse(audit[0].details).after.statusFreshWorkingDays).toBe(3);
    });

    it('switching on sets the go-live date once; off and on again keeps it; Baseline for 4 weeks', async () => {
      await patch(f.users.pm, `/performance-tracking/projects/999999`, { enabled: true }).expect(404);
      await patch(f.users.pm, `/performance-tracking/projects/${f.projects.pT2}`, { enabled: true }).expect(404);
      await patch(f.users.pm, `/performance-tracking/projects/${f.projects.pA}`, { enabled: 'on' }).expect(400);
      const on = (await patch(f.users.admin, `/performance-tracking/projects/${f.projects.pA}`, { enabled: true }).expect(200)).body;
      expect(on.performanceTrackingSince).not.toBeNull();
      await patch(f.users.pm, `/performance-tracking/projects/${f.projects.pA}`, { enabled: false }).expect(200);
      const off = (await get(f.users.pm, '/performance-tracking/settings').expect(200)).body.projects.find((p: any) => p.id === f.projects.pA);
      expect(off).toMatchObject({ performanceTrackingEnabled: false, phase: 'off' });
      expect(new Date(off.performanceTrackingSince).getTime()).toBe(new Date(on.performanceTrackingSince).getTime());
      await patch(f.users.pm, `/performance-tracking/projects/${f.projects.pA}`, { enabled: true }).expect(200);
      const again = (await get(f.users.pm, '/performance-tracking/settings').expect(200)).body.projects.find((p: any) => p.id === f.projects.pA);
      expect(again).toMatchObject({ performanceTrackingEnabled: true, phase: 'baseline' });
      expect(new Date(again.performanceTrackingSince).getTime()).toBe(new Date(on.performanceTrackingSince).getTime());
      const audit = await ds.query(`SELECT details FROM audit_logs WHERE action = 'project_performance_tracking_switched' ORDER BY id`);
      expect(audit.map((a: any) => [JSON.parse(a.details).from, JSON.parse(a.details).to])).toEqual([[false, true], [true, false], [false, true]]);
    });
  });

  describe('projectTrackingPhase', () => {
    const since = new Date('2026-11-02T06:00:00Z');
    it('off until switched on, Baseline for baselineDays, then scoring', () => {
      expect(projectTrackingPhase(false, since, new Date('2026-12-30T00:00:00Z'), 28).phase).toBe('off');
      expect(projectTrackingPhase(true, null, new Date('2026-12-30T00:00:00Z'), 28).phase).toBe('off');
      expect(projectTrackingPhase(true, since, new Date('2026-11-29T23:59:00Z'), 28).phase).toBe('baseline');
      const at = projectTrackingPhase(true, since, new Date('2026-11-30T06:00:00Z'), 28);
      expect(at).toEqual({ phase: 'scoring', baselineEndsAt: new Date('2026-11-30T06:00:00Z') });
      expect(projectTrackingPhase(true, since, since, 0).phase).toBe('scoring');
    });
  });
});
