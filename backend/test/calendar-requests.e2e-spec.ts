import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { WORK_CALENDAR_AUDIT, COUNTRIES } from '../src/work-calendar/work-calendar';
import { TASK_REQUEST_AUDIT } from '../src/task-requests/task-requests';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';

// Performance Tracking B4 (2026-10-30): per-person working calendar,
// leave and country holidays (PM/Admin, audited); requests on a task and
// dependency answers (C1); the nightly run writes C1.
describe('Work calendar + requests (Performance Tracking B4, e2e)', () => {
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
  const del = (u: FixtureUser, url: string) => http().delete(url).set(auth(u));
  const audits = (action: string) => ds.query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);
  const setTracking = (projectId: number, enabled: boolean) => patch(f.users.pm, `/performance-tracking/projects/${projectId}`, { enabled }).expect(200);
  const notified = async (userId: number, type: string, taskId: number) => {
    for (let i = 0; i < 40; i++) {
      const rows = await ds.query(`SELECT 1 FROM user_notifications WHERE "userId" = $1 AND type = $2 AND link = $3`, [userId, type, `/tasks/${taskId}#requests`]);
      if (rows.length) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
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
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_requests, person_work_calendars, person_leave, country_holidays,
                performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, audit_logs, user_notifications RESTART IDENTITY CASCADE`,
    );
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

  it('the migration names user #3 as the only override user, with an audit entry, and keeps the country list in step', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-11-performance-tracking-calendar-requests.sql'), 'utf8');
    expect(sql).toMatch(/'\[3\]'::jsonb FROM "users" u WHERE u\.id = 3/);
    expect(sql).toMatch(/INSERT INTO "audit_logs"/);
    const m = sql.match(/"CHK_pwc_country" CHECK \("country" IS NULL OR "country" IN \(([^)]*)\)\)/);
    expect(m![1].split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...COUNTRIES]);
  });

  describe('work calendar', () => {
    it('PM and Admin only; everyone starts on the default (EAT, 07:30-15:30, Sat/Sun off)', async () => {
      await get(f.users.devA, '/work-calendars').expect(403);
      await get(f.users.exec, '/work-calendars').expect(403);
      const page = (await get(f.users.pm, '/work-calendars').expect(200)).body;
      expect(page.defaults).toEqual({ timeZone: 'Africa/Addis_Ababa', workStart: '07:30', workEnd: '15:30', weekendDays: [0, 6] });
      expect(page.holidays).toEqual([]);
      const dev = page.people.find((p: any) => p.userId === f.users.devA.id);
      expect(dev).toMatchObject({ own: false, timeZone: 'Africa/Addis_Ababa', workStart: '07:30', workEnd: '15:30', country: null });
      expect(page.people.some((p: any) => p.role === 'client')).toBe(false);
    });

    it('sets a person calendar (checked, audited), and resets it', async () => {
      const url = `/work-calendars/people/${f.users.devA.id}`;
      await patch(f.users.pm, url, { timeZone: 'Mars/Olympus', workStart: '09:30', workEnd: '18:00', weekendDays: [0, 6] }).expect(400);
      await patch(f.users.pm, url, { timeZone: 'Asia/Kolkata', workStart: '18:00', workEnd: '09:30', weekendDays: [0, 6] }).expect(400);
      await patch(f.users.pm, url, { timeZone: 'Asia/Kolkata', workStart: '09:30', workEnd: '18:00', weekendDays: [0, 6], country: 'mars' }).expect(400);
      await patch(f.users.devA, url, { timeZone: 'Asia/Kolkata', workStart: '09:30', workEnd: '18:00', weekendDays: [0, 6] }).expect(403);
      await patch(f.users.pm, `/work-calendars/people/${f.users.clientA.id}`, { timeZone: 'Asia/Kolkata', workStart: '09:30', workEnd: '18:00', weekendDays: [0, 6] }).expect(404);
      const page = (await patch(f.users.pm, url, { timeZone: 'Asia/Kolkata', workStart: '09:30', workEnd: '18:00', weekendDays: [6, 0], country: 'india' }).expect(200)).body;
      expect(page.people.find((p: any) => p.userId === f.users.devA.id)).toMatchObject({ own: true, timeZone: 'Asia/Kolkata', weekendDays: [0, 6], country: 'india' });
      expect(await audits(WORK_CALENDAR_AUDIT.CALENDAR_SET)).toHaveLength(1);
      await del(f.users.pm, url).expect(200);
      await del(f.users.pm, url).expect(400);
      expect(await audits(WORK_CALENDAR_AUDIT.CALENDAR_RESET)).toHaveLength(1);
    });

    it('leave: whole days, no overlaps, removable, audited', async () => {
      await post(f.users.pm, '/work-calendars/leave', { userId: f.users.devA.id, startDate: '2026-11-20', endDate: '2026-11-18' }).expect(400);
      await post(f.users.devA, '/work-calendars/leave', { userId: f.users.devA.id, startDate: '2026-11-18', endDate: '2026-11-20' }).expect(403);
      const page = (await post(f.users.admin, '/work-calendars/leave', { userId: f.users.devA.id, startDate: '2026-11-18', endDate: '2026-11-20', note: 'Family' }).expect(201)).body;
      expect(page.leave).toHaveLength(1);
      await post(f.users.pm, '/work-calendars/leave', { userId: f.users.devA.id, startDate: '2026-11-20', endDate: '2026-11-23' }).expect(400);
      await patch(f.users.pm, `/work-calendars/leave/${page.leave[0].id}/remove`).expect(200);
      await patch(f.users.pm, `/work-calendars/leave/${page.leave[0].id}/remove`).expect(400);
      expect(await audits(WORK_CALENDAR_AUDIT.LEAVE_ADDED)).toHaveLength(1);
      expect(await audits(WORK_CALENDAR_AUDIT.LEAVE_REMOVED)).toHaveLength(1);
    });

    it('country holidays: one per country per day, removable, audited', async () => {
      await post(f.users.pm, '/work-calendars/holidays', { country: 'somaliland', date: '2027-05-18', name: '' }).expect(400);
      await post(f.users.pm, '/work-calendars/holidays', { country: 'kenya', date: '2027-05-18', name: 'x' }).expect(400);
      const page = (await post(f.users.pm, '/work-calendars/holidays', { country: 'somaliland', date: '2027-05-18', name: 'Restoration of Sovereignty Day' }).expect(201)).body;
      await post(f.users.pm, '/work-calendars/holidays', { country: 'somaliland', date: '2027-05-18', name: 'Again' }).expect(400);
      await post(f.users.pm, '/work-calendars/holidays', { country: 'india', date: '2027-05-18', name: 'Same day, other country' }).expect(201);
      await del(f.users.pm, `/work-calendars/holidays/${page.holidays[0].id}`).expect(200);
      expect(await audits(WORK_CALENDAR_AUDIT.HOLIDAY_ADDED)).toHaveLength(2);
      expect(await audits(WORK_CALENDAR_AUDIT.HOLIDAY_REMOVED)).toHaveLength(1);
    });
  });

  describe('requests (C1)', () => {
    let taskId: number;
    beforeAll(async () => {
      taskId = await newTask('Requests task');
    });

    it('OFF: nothing shown, nothing accepted', async () => {
      await setTracking(f.projects.pA, false);
      expect((await get(f.users.pm, `/tasks/${taskId}/requests`).expect(200)).body).toEqual({ trackingOn: false });
      await post(f.users.pm, `/tasks/${taskId}/requests`, { requestedOfUserId: f.users.devA.id, body: 'Can you share the API keys?' }).expect(400);
      await setTracking(f.projects.pA, true);
    });

    it('ask a named person; never yourself or a client; the person is told and only they answer', async () => {
      await post(f.users.pm, `/tasks/${taskId}/requests`, { requestedOfUserId: f.users.pm.id, body: 'Can you share the API keys?' }).expect(400);
      await post(f.users.pm, `/tasks/${taskId}/requests`, { requestedOfUserId: f.users.clientA.id, body: 'Can you share the API keys?' }).expect(404);
      await post(f.users.pm, `/tasks/${taskId}/requests`, { requestedOfUserId: f.users.devA.id, body: 'short' }).expect(400);
      const body = (await post(f.users.pm, `/tasks/${taskId}/requests`, { requestedOfUserId: f.users.devA.id, body: 'Can you share the API keys?' }).expect(201)).body;
      expect(body.requests[0]).toMatchObject({ source: 'request', requestedOfName: 'Name devA', canAnswer: false });
      expect(await notified(f.users.devA.id, 'task.requestCreated', taskId)).toBe(true);
      const id = body.requests[0].id;
      await post(f.users.pm, `/task-requests/${id}/answer`, { body: 'Answering my own question' }).expect(403);
      const mine = (await get(f.users.devA, `/tasks/${taskId}/requests`).expect(200)).body;
      expect(mine.requests[0].canAnswer).toBe(true);
      const answered = (await post(f.users.devA, `/task-requests/${id}/answer`, { body: 'Sent them by email' }).expect(201)).body;
      expect(answered.requests[0].responseBody).toBe('Sent them by email');
      await post(f.users.devA, `/task-requests/${id}/answer`, { body: 'Sent them again' }).expect(400);
      expect(await notified(f.users.pm.id, 'task.requestAnswered', taskId)).toBe(true);
      expect(await audits(TASK_REQUEST_AUDIT.CREATED)).toHaveLength(1);
      expect(await audits(TASK_REQUEST_AUDIT.ANSWERED)).toHaveLength(1);
    });

    it('the owner of a dependency answers it once, without resolving it', async () => {
      const [ticket] = await ds.query(
        `INSERT INTO task_dependency_tickets ("tenantId", "parentTaskId", title, description, "ownerUserId", "ownerEmail", "createdByUserId", "createdByEmail", status)
         VALUES ($1, $2, 'Keys', 'Need keys', $3, $4, $5, $6, 'open') RETURNING id`,
        [f.tenants.t1, taskId, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
      );
      const state = (await get(f.users.devA, `/tasks/${taskId}/requests`).expect(200)).body;
      expect(state.dependenciesToAnswer.map((d: any) => d.id)).toEqual([ticket.id]);
      await post(f.users.pm, `/task-requests/dependency/${ticket.id}/answer`, { body: 'Not mine to answer' }).expect(403);
      const after = (await post(f.users.devA, `/task-requests/dependency/${ticket.id}/answer`, { body: 'On it, by Friday' }).expect(201)).body;
      expect(after.dependenciesToAnswer).toEqual([]);
      await post(f.users.devA, `/task-requests/dependency/${ticket.id}/answer`, { body: 'Again' }).expect(400);
      const [row] = await ds.query(`SELECT * FROM task_requests WHERE source = 'dependency'`);
      expect(row).toMatchObject({ dependencyTicketId: ticket.id, requestedOfUserId: f.users.devA.id, requestedByUserId: f.users.pm.id });
      const [t] = await ds.query(`SELECT status FROM task_dependency_tickets WHERE id = $1`, [ticket.id]);
      expect(t.status).toBe('open');
    });

    it('the nightly run writes C1', async () => {
      const result = await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' });
      expect(result.status).toBe('done');
      const [c1] = await ds.query(`SELECT * FROM performance_metric_snapshots WHERE metric = 'C1' AND "userId" = $1`, [f.users.devA.id]);
      expect(c1).toBeDefined();
      expect(c1.details.targetWorkingHours).toBe(4);
    });
  });
});
