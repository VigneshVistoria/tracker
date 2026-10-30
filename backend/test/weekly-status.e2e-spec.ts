import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { WEEKLY_STATUS_AUDIT, mondayOf } from '../src/weekly-status/weekly-status';
import { WeeklyReportsService } from '../src/reports/weekly-reports.service';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';
import { dateInZone } from '../src/team-settings/time-zone';
import { addCalendarDays } from '../src/performance-metrics/working-days';

// Performance Tracking C3 (2026-10-30): the per-person weekly status
// report (deadline default Thursday 17:00 EAT, first submission counts),
// who sees what, and the Weekly Reports page fix (one card per week,
// reports from before the 26 Oct fix not available, Saturday job unsaved).
describe('Weekly status report (Performance Tracking C3, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  const thisWeek = mondayOf(dateInZone(new Date(), 'Africa/Addis_Ababa'));
  const report = { done: 'Finished the refund API and its tests', plan: 'Start the claims import next week' };

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const put = (u: FixtureUser, body: any) => http().put('/weekly-status').set(auth(u)).send(body);
  const audits = (action: string) => ds.query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);
  // A deadline that has passed this week (Monday 00:01) or not (Sunday 23:59).
  const deadline = (day: number, time: string) => patch(f.users.pm, '/performance-tracking/settings', { weeklyReportDeadlineDay: day, weeklyReportDeadlineTime: time }).expect(200);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE weekly_status_reports, weekly_reports, performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, audit_logs RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('starts only once a project is tracked; QA cannot see it', async () => {
    await get(f.users.devA, '/weekly-status').expect(400);
    await patch(f.users.pm, `/performance-tracking/projects/${f.projects.pA}`, { enabled: true }).expect(200);
    await get(f.users.qaB, '/weekly-status').expect(403);
    const { body } = await get(f.users.devA, '/weekly-status').expect(200);
    expect(body).toMatchObject({ week: thisWeek, currentWeek: thisWeek, canSubmit: true, editable: true, mine: null, team: null, minLength: 20 });
    expect(new Date(body.deadlineAt).toISOString()).toBe(new Date(new Date(`${addCalendarDays(thisWeek, 3)}T17:00:00+03:00`)).toISOString());
  });

  it('settings: deadline day and time are checked', async () => {
    await patch(f.users.pm, '/performance-tracking/settings', { weeklyReportDeadlineTime: '25:00' }).expect(400);
    await patch(f.users.pm, '/performance-tracking/settings', { weeklyReportDeadlineDay: 7 }).expect(400);
  });

  it('refuses short text, a future week, and weeks before last week; only developers submit', async () => {
    await put(f.users.devA, { week: thisWeek, done: 'short', plan: report.plan }).expect(400);
    await put(f.users.devA, { week: addCalendarDays(thisWeek, 7), ...report }).expect(400);
    await put(f.users.devA, { week: addCalendarDays(thisWeek, -14), ...report }).expect(400);
    await put(f.users.pm, { week: thisWeek, ...report }).expect(403);
  });

  it('submits on time before the deadline; an edit keeps the first submission time', async () => {
    await deadline(0, '23:59');
    const { body } = await put(f.users.devA, { week: thisWeek, ...report }).expect(200);
    expect(body.mine).toMatchObject({ ...report, blockers: null, status: 'on_time' });
    const first = body.mine.submittedAt;
    const edited = (await put(f.users.devA, { week: thisWeek, ...report, blockers: 'Waiting on the claims API keys' }).expect(200)).body;
    expect(edited.mine).toMatchObject({ blockers: 'Waiting on the claims API keys', submittedAt: first, status: 'on_time' });
    expect(await audits(WEEKLY_STATUS_AUDIT.SUBMITTED)).toHaveLength(1);
    expect(await audits(WEEKLY_STATUS_AUDIT.UPDATED)).toHaveLength(1);
  });

  it('after the deadline a submission is late; last week can still be submitted (late)', async () => {
    await deadline(1, '00:01');
    const late = (await put(f.users.devNone, { week: thisWeek, ...report }).expect(200)).body;
    expect(late.mine.status).toBe('late');
    const last = (await put(f.users.devNone, { week: addCalendarDays(thisWeek, -7), ...report }).expect(200)).body;
    expect(last).toMatchObject({ week: addCalendarDays(thisWeek, -7), mine: { status: 'late' } });
  });

  it('PM, Executive and Admin see the team; a developer only their own', async () => {
    const { body } = await get(f.users.exec, `/weekly-status?week=${thisWeek}`).expect(200);
    expect(body.canSubmit).toBe(false);
    const byId = Object.fromEntries(body.team.map((t: any) => [t.userId, t]));
    expect(byId[f.users.devA.id]).toMatchObject({ status: 'on_time', report: { done: report.done } });
    expect(byId[f.users.devNone.id]).toMatchObject({ status: 'late' });
    const dev = (await get(f.users.devA, `/weekly-status?week=${thisWeek}`).expect(200)).body;
    expect(dev.team).toBeNull();
  });

  it('the nightly run writes C3 for the people measured', async () => {
    await ds.query(`UPDATE projects SET "performanceTrackingSince" = now() - interval '20 days' WHERE id = $1`, [f.projects.pA]);
    expect((await app.get(TrackingMetricsService).runTenant(f.tenants.t1, { trigger: 'manual' })).status).toBe('done');
    const [row] = await ds.query(`SELECT sample, denominator, details FROM performance_metric_snapshots WHERE metric = 'C3' AND "userId" = $1`, [f.users.devNone.id]);
    // This week's (Monday 00:01) and last week's deadlines have passed.
    expect(row.sample).toBeGreaterThanOrEqual(2);
    expect(row.details.late).toEqual(expect.arrayContaining([thisWeek]));
  });

  describe('Weekly Reports page', () => {
    const save = (week: string, generatedAt: string, data: any = { weekStartDate: week, weekEndDate: week, overall: {} }) =>
      ds.query(`INSERT INTO weekly_reports ("weekStartDate", "weekEndDate", data, "generatedAt", "tenantId") VALUES ($1, $1, $2, $3, $4)`, [week, JSON.stringify(data), generatedAt, f.tenants.t1]);

    it('one card per week (the newest); reports from before the 26 Oct fix are not available', async () => {
      await save('2026-10-12', '2026-10-12T08:00:00Z');
      await save('2026-10-12', '2026-10-17T08:00:00Z');
      await save('2026-10-26', '2026-10-26T09:28:25Z');
      await save('2026-10-26', '2026-10-26T09:30:01Z');
      const { body } = await get(f.users.admin, '/reports/weekly/history').expect(200);
      expect(body.map((r: any) => [r.weekStartDate, r.available, r.data === null])).toEqual([
        ['2026-10-26', true, false],
        ['2026-10-12', false, true],
      ]);
    });

    it('the Saturday job builds the report without adding a card', async () => {
      const before = (await ds.query(`SELECT count(*)::int AS n FROM weekly_reports`))[0].n;
      const built = await app.get(WeeklyReportsService).generate(new Date(), f.tenants.t1, undefined, { save: false });
      expect(built.data).toBeTruthy();
      expect((await ds.query(`SELECT count(*)::int AS n FROM weekly_reports`))[0].n).toBe(before);
    });
  });
});
