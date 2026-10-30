import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import {
  BLOCKER_LAG_CLOCK_STARTS,
  NON_COMPLIANCE_DISPLAYS,
  PERFORMANCE_TRACKING_DEFAULTS,
} from '../src/performance-tracking/performance-tracking';
import { TASK_ACTIVITY_AUDIT } from '../src/task-activity/task-activity';

// Performance Tracking B1 (2026-10-30, fast-track plan): the open
// decisions as settings with defaults, the Chase button (O3) and the
// assignee's progress note (C5). OFF = nothing changes. ON = anyone in
// chaseRoles who can see the task (never the assignee) chases its
// assignee, at most once per cooldown, and the assignee is told in-app;
// only the assignee writes progress notes, at least progressNoteMin long.
// Neither works on Pass/Junk/Closed/Released tasks.
describe('Chase + progress notes + decision settings (Performance Tracking B1, e2e)', () => {
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
  const setTracking = (projectId: number, enabled: boolean) => patch(f.users.pm, `/performance-tracking/projects/${projectId}`, { enabled }).expect(200);
  const NOTE = 'Payment screen done, wiring the refund call next';
  const notified = async (userId: number, taskId: number) => {
    for (let i = 0; i < 40; i++) {
      const rows = await ds.query(`SELECT * FROM user_notifications WHERE "userId" = $1 AND type = 'task.chased' AND link = $2`, [userId, `/tasks/${taskId}#activity`]);
      if (rows.length) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    return [];
  };
  const newTask = async (title: string, status = 'Development', assignee: FixtureUser | null = f.users.devA) =>
    (
      await ds.query(
        `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", "title", "description", "status", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
         VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, $5, 'x', $6, $7, $8, $9, $10, $11) RETURNING id`,
        [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, 'Build', title, status, assignee?.id ?? null, assignee?.email ?? null, f.users.pm.id, f.users.pm.email],
      )
    )[0].id as number;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_chases, task_progress_notes, performance_tracking_settings, audit_logs, user_notifications RESTART IDENTITY CASCADE`);
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

  it('the CHECK lists in the migration match the code', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-11-performance-tracking-chase-notes.sql'), 'utf8');
    const list = (name: string) => {
      const m = sql.match(new RegExp(`"${name}" CHECK \\("\\w+" IN \\(([^)]*)\\)\\)`));
      return m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')) : null;
    };
    expect(list('CHK_pts_blocker_lag_clock')).toEqual([...BLOCKER_LAG_CLOCK_STARTS]);
    expect(list('CHK_pts_non_compliance_display')).toEqual([...NON_COMPLIANCE_DISPLAYS]);
  });

  describe('decision settings', () => {
    it('starts at the defaults the TD is asked to review, with the choices for the screen', async () => {
      const body = (await get(f.users.admin, '/performance-tracking/settings').expect(200)).body;
      expect(body.isDefault).toBe(true);
      expect(body.settings).toMatchObject({
        notReadyDeclaredDependencyExempt: true,
        blockerLagClockStart: 'dependency_overdue_or_blocker',
        percentBands: [95, 85, 70, 50],
        breachBands: [0, 1, 2, 3],
        nonComplianceDisplay: 'side_by_side',
        requestSources: ['owned_dependency', 'marked_request'],
        chaseRoles: ['admin', 'program_manager', 'executive', 'qa', 'developer'],
        chaseCooldownHours: 24,
        progressNoteMin: 20,
      });
      expect(body.choices.blockerLagClockStart).toEqual([...BLOCKER_LAG_CLOCK_STARTS]);
      expect(body.limits.progressNoteMin).toEqual([5, 500]);
    });

    it('refuses bad bands, unknown choices and empty lists', async () => {
      await patch(f.users.pm, '/performance-tracking/settings', { percentBands: [95, 85, 70] }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { percentBands: [50, 70, 85, 95] }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { percentBands: [101, 85, 70, 50] }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { breachBands: [0, 0, 1, 2] }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { blockerLagClockStart: 'whenever' }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { nonComplianceDisplay: 'replace' }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { requestSources: [] }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { chaseRoles: ['client'] }).expect(400);
      await patch(f.users.pm, '/performance-tracking/settings', { progressNoteMin: 2 }).expect(400);
      await patch(f.users.devA, '/performance-tracking/settings', { progressNoteMin: 30 }).expect(403);
      const rows = await ds.query(`SELECT * FROM performance_tracking_settings`);
      expect(rows).toHaveLength(0);
    });

    it('saves, audits before/after, and an untouched setting keeps its value', async () => {
      const body = (
        await patch(f.users.admin, '/performance-tracking/settings', { percentBands: [90, 80, 65, 50], blockerLagClockStart: 'blocker_flag', progressNoteMin: 25 }).expect(200)
      ).body;
      expect(body.settings).toEqual({ ...PERFORMANCE_TRACKING_DEFAULTS, percentBands: [90, 80, 65, 50], blockerLagClockStart: 'blocker_flag', progressNoteMin: 25 });
      const [audit] = await ds.query(`SELECT details FROM audit_logs WHERE action = 'performance_tracking_settings_updated' ORDER BY id DESC LIMIT 1`);
      const details = JSON.parse(audit.details);
      expect(details.before.percentBands).toEqual([95, 85, 70, 50]);
      expect(details.after.percentBands).toEqual([90, 80, 65, 50]);
      // Back to the defaults for the rest of the suite.
      await patch(f.users.admin, '/performance-tracking/settings', { percentBands: [95, 85, 70, 50], blockerLagClockStart: 'dependency_overdue_or_blocker', progressNoteMin: 20 }).expect(200);
    });
  });

  describe('tracking OFF', () => {
    it('shows nothing and refuses Chase and notes', async () => {
      await setTracking(f.projects.pA, false);
      const taskId = await newTask('Off task');
      expect((await get(f.users.pm, `/tasks/${taskId}/activity`).expect(200)).body).toEqual({ trackingOn: false });
      await post(f.users.pm, `/tasks/${taskId}/activity/chase`).expect(400);
      await post(f.users.devA, `/tasks/${taskId}/activity/notes`, { body: NOTE }).expect(400);
      expect(await ds.query(`SELECT * FROM task_chases`)).toHaveLength(0);
      expect(await ds.query(`SELECT * FROM task_progress_notes`)).toHaveLength(0);
    });
  });

  describe('tracking ON', () => {
    beforeAll(async () => {
      await setTracking(f.projects.pA, true);
    });

    it('a PM chases the assignee: logged, audited, assignee told in-app', async () => {
      const taskId = await newTask('Chase task');
      const body = (await post(f.users.pm, `/tasks/${taskId}/activity/chase`, { note: '  Client demo is Monday  ' }).expect(201)).body;
      expect(body.canChase).toBe(false);
      expect(body.chaseBlockedReason).toMatch(/last 24 hours/);
      expect(body.chases).toHaveLength(1);
      expect(body.chases[0]).toMatchObject({ note: 'Client demo is Monday', taskStatus: 'Development', chasedByName: 'Name pm', assigneeName: 'Name devA' });
      const [row] = await ds.query(`SELECT * FROM task_chases WHERE "taskId" = $1`, [taskId]);
      expect(row).toMatchObject({ assigneeUserId: f.users.devA.id, chasedByUserId: f.users.pm.id, projectId: f.projects.pA });
      const audit = await ds.query(`SELECT * FROM audit_logs WHERE action = $1 AND "entityId" = $2`, [TASK_ACTIVITY_AUDIT.CHASED, taskId]);
      expect(audit).toHaveLength(1);
      const sent = await notified(f.users.devA.id, taskId);
      expect(sent).toHaveLength(1);
      expect(sent[0].title).toBe(`Name pm is asking for an update on #${taskId}`);
    });

    it('one Chase per person per cooldown; another person may still chase', async () => {
      const taskId = await newTask('Cooldown task');
      await post(f.users.pm, `/tasks/${taskId}/activity/chase`).expect(201);
      await post(f.users.pm, `/tasks/${taskId}/activity/chase`).expect(400);
      await post(f.users.exec, `/tasks/${taskId}/activity/chase`).expect(201);
      // An old chase no longer blocks.
      await ds.query(`UPDATE task_chases SET "createdAt" = now() - interval '25 hours' WHERE "taskId" = $1 AND "chasedByUserId" = $2`, [taskId, f.users.pm.id]);
      await post(f.users.pm, `/tasks/${taskId}/activity/chase`).expect(201);
      expect(await ds.query(`SELECT * FROM task_chases WHERE "taskId" = $1`, [taskId])).toHaveLength(3);
    });

    it('never the assignee, never someone who cannot see the task, only the chase roles', async () => {
      const taskId = await newTask('Who chases');
      const self = (await get(f.users.devA, `/tasks/${taskId}/activity`).expect(200)).body;
      expect(self).toMatchObject({ canChase: false, chaseBlockedReason: 'You cannot chase your own task.', canAddNote: true });
      await post(f.users.devA, `/tasks/${taskId}/activity/chase`).expect(403);
      await post(f.users.devNone, `/tasks/${taskId}/activity/chase`).expect(403);
      await post(f.users.clientA, `/tasks/${taskId}/activity/chase`).expect(403);
      await patch(f.users.admin, '/performance-tracking/settings', { chaseRoles: ['admin', 'program_manager'] }).expect(200);
      await post(f.users.exec, `/tasks/${taskId}/activity/chase`).expect(403);
      await post(f.users.admin, `/tasks/${taskId}/activity/chase`).expect(201);
      await patch(f.users.admin, '/performance-tracking/settings', { chaseRoles: PERFORMANCE_TRACKING_DEFAULTS.chaseRoles }).expect(200);
    });

    it('no Chase on a task without an assignee or once it is Pass/Closed', async () => {
      const unassigned = await newTask('Nobody on it', 'Development', null);
      await post(f.users.pm, `/tasks/${unassigned}/activity/chase`).expect(400);
      const passed = await newTask('Passed', 'Pass');
      await post(f.users.pm, `/tasks/${passed}/activity/chase`).expect(400);
      const closed = await newTask('Closed', 'Closed');
      await post(f.users.pm, `/tasks/${closed}/activity/chase`).expect(400);
    });

    it('the assignee adds progress notes; at least the minimum length; nobody else', async () => {
      const taskId = await newTask('Notes task');
      await post(f.users.devA, `/tasks/${taskId}/activity/notes`, { body: 'too short' }).expect(400);
      await post(f.users.pm, `/tasks/${taskId}/activity/notes`, { body: NOTE }).expect(403);
      const pmView = (await get(f.users.pm, `/tasks/${taskId}/activity`).expect(200)).body;
      expect(pmView.canAddNote).toBe(false);
      const body = (await post(f.users.devA, `/tasks/${taskId}/activity/notes`, { body: `  ${NOTE}  ` }).expect(201)).body;
      expect(body.notes).toHaveLength(1);
      expect(body.notes[0]).toMatchObject({ body: NOTE, authorName: 'Name devA', taskStatus: 'Development' });
      expect(body.progressNoteMin).toBe(20);
      const audit = await ds.query(`SELECT * FROM audit_logs WHERE action = $1 AND "entityId" = $2`, [TASK_ACTIVITY_AUDIT.PROGRESS_NOTE_ADDED, taskId]);
      expect(audit).toHaveLength(1);
      expect(JSON.parse(audit[0].details)).toMatchObject({ length: NOTE.length, taskStatus: 'Development' });
    });

    it('the minimum note length follows the setting', async () => {
      const taskId = await newTask('Notes min');
      await patch(f.users.admin, '/performance-tracking/settings', { progressNoteMin: 60 }).expect(200);
      await post(f.users.devA, `/tasks/${taskId}/activity/notes`, { body: NOTE }).expect(400);
      await patch(f.users.admin, '/performance-tracking/settings', { progressNoteMin: 20 }).expect(200);
      await post(f.users.devA, `/tasks/${taskId}/activity/notes`, { body: NOTE }).expect(201);
    });

    it('no notes once the task is Released; Junk refused too (hidden from the developer)', async () => {
      const released = await newTask('Released', 'Released - No Showstoppers');
      await post(f.users.devA, `/tasks/${released}/activity/notes`, { body: NOTE }).expect(400);
      const junk = await newTask('Junk', 'Junk');
      await post(f.users.devA, `/tasks/${junk}/activity/notes`, { body: NOTE }).expect(403);
      await post(f.users.pm, `/tasks/${junk}/activity/chase`).expect(400);
    });

    it('someone who cannot see the task gets 403 on the state too', async () => {
      const taskId = await newTask('Hidden');
      await get(f.users.devNone, `/tasks/${taskId}/activity`).expect(403);
    });
  });
});
