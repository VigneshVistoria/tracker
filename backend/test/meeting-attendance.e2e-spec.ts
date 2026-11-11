import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { MEETING_ATTENDANCE_AUDIT, MEETING_ATTENDANCE_DEFAULTS, classifyAttendance } from '../src/meeting-attendance/meeting-attendance';
import { PERFORMANCE_TRACKING_AUDIT } from '../src/performance-tracking/performance-tracking';

// C6 meeting attendance, Stage 1 (2026-11-11): the settings - OFF by
// default, Admin-only edits, audited, validated, and kept apart from the
// main Performance Tracking settings save.
describe('C6 meeting attendance - settings (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const patch = (u: FixtureUser, url: string, body: any = {}) => http().patch(url).set(auth(u)).send(body);
  const series = (organiserUserId: number, seriesId = 'AAMk-series-1', subject = 'Daily Scrum') => ({ organiserUserId, seriesId, subject });

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE audit_logs, performance_tracking_settings, meeting_attendance_imports, meeting_attendance, meeting_occurrences RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows the defaults (C6 OFF, not scored) to Admin and PM; nobody else', async () => {
    const res = await get(f.users.pm, '/meeting-attendance/settings').expect(200);
    expect(res.body.settings).toEqual(MEETING_ATTENDANCE_DEFAULTS);
    expect(res.body.settings.meetingAttendanceEnabled).toBe(false);
    expect(res.body.settings.meetingCountInScores).toBe(false);
    expect(res.body.choices.projects.map((p: any) => p.id)).toEqual(expect.arrayContaining([f.projects.pLms]));
    expect(res.body.choices.organisers.some((o: any) => o.role === 'client')).toBe(false);
    await get(f.users.admin, '/meeting-attendance/settings').expect(200);
    for (const u of [f.users.devA, f.users.qaB, f.users.exec, f.users.clientA]) await get(u, '/meeting-attendance/settings').expect(403);
  });

  it('only an Admin can change the settings', async () => {
    await patch(f.users.pm, '/meeting-attendance/settings', { meetingLateMinutes: 10 }).expect(403);
    await patch(f.users.devA, '/meeting-attendance/settings', { meetingLateMinutes: 10 }).expect(403);
    const rows = await ds.query(`SELECT count(*)::int AS n FROM performance_tracking_settings`);
    expect(rows[0].n).toBe(0);
  });

  it('refuses to switch C6 on without projects, organisers and a series', async () => {
    let res = await patch(f.users.admin, '/meeting-attendance/settings', { meetingAttendanceEnabled: true }).expect(400);
    expect(res.body.message).toMatch(/project/);
    res = await patch(f.users.admin, '/meeting-attendance/settings', { meetingAttendanceEnabled: true, meetingAttendanceProjectIds: [f.projects.pLms] }).expect(400);
    expect(res.body.message).toMatch(/organiser/);
    res = await patch(f.users.admin, '/meeting-attendance/settings', {
      meetingAttendanceEnabled: true,
      meetingAttendanceProjectIds: [f.projects.pLms],
      meetingOrganiserUserIds: [f.users.pm.id],
    }).expect(400);
    expect(res.body.message).toMatch(/series/);
  });

  it('validates projects, organisers, series, numbers, reasons and roles', async () => {
    const bad: Array<[any, RegExp | null]> = [
      [{ meetingAttendanceProjectIds: [f.projects.pT2] }, /project/],
      [{ meetingOrganiserUserIds: [f.users.clientA.id] }, /internal/],
      [{ meetingOrganiserUserIds: [f.users.pmT2.id] }, /internal/],
      [{ meetingTrackedSeries: [series(f.users.pm.id)] }, /not in the organiser list/],
      [{ meetingOrganiserUserIds: [f.users.pm.id], meetingTrackedSeries: [series(f.users.pm.id), series(f.users.pm.id)] }, /twice/],
      [{ meetingLateMinutes: -1 }, null],
      [{ meetingLateMinutes: 61 }, null],
      [{ meetingMinStayPercent: 0 }, null],
      [{ meetingMinStayPercent: 101 }, null],
      [{ meetingImportDays: 31 }, null],
      [{ meetingExcuseReasons: [] }, /excuse reasons/],
      [{ meetingExcuseReasons: ['Leave', 'leave'] }, /different/],
      [{ meetingExcuseReasons: ['  '] }, /1 to 80/],
      [{ meetingExcuseRoles: [] }, /role/],
      [{ meetingExcuseRoles: ['developer'] }, null],
    ];
    for (const [body, msg] of bad) {
      const res = await patch(f.users.admin, '/meeting-attendance/settings', body).expect(400);
      if (msg) expect(String(res.body.message)).toMatch(msg);
    }
    const rows = await ds.query(`SELECT count(*)::int AS n FROM performance_tracking_settings`);
    expect(rows[0].n).toBe(0);
  });

  it('an Admin save is stored and audited with before and after; switching on works once complete', async () => {
    const body = {
      meetingAttendanceEnabled: true,
      meetingAttendanceProjectIds: [f.projects.pLms],
      meetingOrganiserUserIds: [f.users.pm.id],
      meetingTrackedSeries: [series(f.users.pm.id, 'AAMk-series-1', '  Daily Scrum  ')],
      meetingLateMinutes: 5,
      meetingMinStayPercent: 50,
      meetingExcuseReasons: [' Leave ', 'Sick', 'Client call', 'Training'],
    };
    const res = await patch(f.users.admin, '/meeting-attendance/settings', body).expect(200);
    expect(res.body.settings).toMatchObject({
      meetingAttendanceEnabled: true,
      meetingAttendanceProjectIds: [f.projects.pLms],
      meetingTrackedSeries: [series(f.users.pm.id)],
      meetingExcuseReasons: ['Leave', 'Sick', 'Client call', 'Training'],
      meetingCountInScores: false,
      meetingExcuseRoles: ['program_manager'],
    });
    const audit = await ds.query(`SELECT "userId", details FROM audit_logs WHERE action = $1`, [MEETING_ATTENDANCE_AUDIT.SETTINGS_UPDATED]);
    expect(audit).toHaveLength(1);
    expect(audit[0].userId).toBe(f.users.admin.id);
    const details = JSON.parse(audit[0].details);
    expect(details.before.meetingAttendanceEnabled).toBe(false);
    expect(details.after.meetingAttendanceEnabled).toBe(true);
    // Read back fresh.
    const again = await get(f.users.pm, '/meeting-attendance/settings').expect(200);
    expect(again.body.settings.meetingTrackedSeries).toEqual([series(f.users.pm.id)]);
  });

  it('the main Performance Tracking save (Admin or PM) never touches the C6 settings, and C6 saves keep the main rules', async () => {
    await patch(f.users.pm, '/performance-tracking/settings', { reopenWindowDays: 21 }).expect(200);
    let res = await get(f.users.admin, '/meeting-attendance/settings').expect(200);
    expect(res.body.settings.meetingAttendanceEnabled).toBe(true);
    expect(res.body.settings.meetingExcuseReasons).toHaveLength(4);
    const main = await get(f.users.pm, '/performance-tracking/settings').expect(200);
    expect(Object.keys(main.body.settings).some((k) => k.startsWith('meeting'))).toBe(false);

    await patch(f.users.admin, '/meeting-attendance/settings', { meetingAttendanceEnabled: false, meetingCountInScores: true }).expect(200);
    const main2 = await get(f.users.pm, '/performance-tracking/settings').expect(200);
    expect(main2.body.settings.reopenWindowDays).toBe(21);
    res = await get(f.users.admin, '/meeting-attendance/settings').expect(200);
    expect(res.body.settings).toMatchObject({ meetingAttendanceEnabled: false, meetingCountInScores: true });
    const mainAudits = await ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = $1`, [PERFORMANCE_TRACKING_AUDIT.SETTINGS_UPDATED]);
    expect(mainAudits[0].n).toBe(1);
  });

  it('a series cannot outlive its organiser being removed', async () => {
    const res = await patch(f.users.admin, '/meeting-attendance/settings', { meetingOrganiserUserIds: [f.users.admin.id] }).expect(400);
    expect(res.body.message).toMatch(/not in the organiser list/);
  });

  describe('outcome rules (decisions 2 and 5)', () => {
    const start = new Date('2026-11-10T06:00:00Z');
    const end = new Date('2026-11-10T06:30:00Z'); // 30 minutes
    const at = (min: number) => new Date(start.getTime() + min * 60_000);
    const o = (join: number | null, minutes: number) =>
      classifyAttendance({ startAt: start, endAt: end, firstJoinAt: join === null ? null : at(join), attendedSeconds: minutes * 60, lateMinutes: 5, minStayPercent: 50 });

    it('absent, short, late, on time', () => {
      expect(o(null, 0)).toBe('absent');
      expect(o(0, 0)).toBe('absent');
      expect(o(0, 14)).toBe('short'); // under 50% of 30 min
      expect(o(0, 15)).toBe('on_time'); // exactly 50%
      expect(o(5, 20)).toBe('on_time'); // exactly 5 min is not late
      expect(o(5.1, 20)).toBe('late'); // more than 5 min
      expect(o(-3, 30)).toBe('on_time'); // joined early
      expect(o(20, 10)).toBe('short'); // late and too short = short
    });
  });
});
