import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { MeetingGraphClient, MeetingGraphError } from '../src/meeting-attendance/meeting-graph.client';
import { MeetingImportService } from '../src/meeting-attendance/meeting-import.service';
import { MEETING_ATTENDANCE_AUDIT, GraphAttendanceRecord, GraphInstance, attendanceRows, reportsForInstance } from '../src/meeting-attendance/meeting-attendance';

// C6 meeting attendance, Stage 2 (2026-11-11): series picker, the import
// (nightly 01:30 EAT + "Import now"). Microsoft Graph is replaced by a
// stand-in - these tests never call Teams.
describe('C6 meeting attendance - Teams import (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let graph: MeetingGraphClient;
  let importer: MeetingImportService;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });

  // Two days ago, 06:00-06:30 UTC (09:00 EAT), and the day after.
  const day = (offset: number, min = 0) => {
    const d = new Date();
    d.setUTCHours(6, 0, 0, 0);
    return new Date(d.getTime() + offset * 86_400_000 + min * 60_000);
  };
  const SERIES = 'AAMk-scrum';
  const JOIN = 'https://teams.microsoft.com/l/meetup-join/scrum';
  const interval = (joinMin: number, leaveMin: number, base: number) => ({ joinAt: day(base, joinMin), leaveAt: day(base, leaveMin) });
  let instances: GraphInstance[];
  let records: Record<string, GraphAttendanceRecord[]>;

  const setGraph = () => {
    jest.spyOn(graph, 'userId').mockImplementation(async (email: string) => `aad-${email}`);
    jest.spyOn(graph, 'listSeries').mockResolvedValue([
      { seriesId: SERIES, subject: 'Daily Scrum', pattern: { type: 'weekly', daysOfWeek: ['monday', 'tuesday'] }, rangeEnd: null, startTime: day(-2), endTime: day(-2, 30), joinUrl: JOIN },
    ]);
    jest.spyOn(graph, 'listInstances').mockImplementation(async () => instances);
    jest.spyOn(graph, 'onlineMeetingId').mockResolvedValue('meeting-1');
    jest.spyOn(graph, 'listReports').mockImplementation(async () => [
      { reportId: 'rep-2', startAt: day(-2, -4), endAt: day(-2, 31) },
      { reportId: 'rep-3', startAt: day(-3, 1), endAt: day(-3, 30) },
    ]);
    jest.spyOn(graph, 'listRecords').mockImplementation(async (_a, _m, reportId: string) => records[reportId] ?? []);
  };

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    graph = app.get(MeetingGraphClient);
    importer = app.get(MeetingImportService);
    await ds.query(`TRUNCATE audit_logs, performance_tracking_settings, meeting_attendance_imports, meeting_attendance, meeting_occurrences RESTART IDENTITY CASCADE`);
    const invitees = [f.users.devA.email, f.users.qaB.email, f.users.devNone.email, f.users.admin.email, 'guest@outside.example', f.users.clientA.email].map((e) => e.toLowerCase());
    instances = [
      { eventId: 'ev-3', subject: 'Daily Scrum', startAt: day(-3), endAt: day(-3, 30), cancelled: false, joinUrl: JOIN, invitees },
      { eventId: 'ev-2', subject: 'Daily Scrum', startAt: day(-2), endAt: day(-2, 30), cancelled: false, joinUrl: JOIN, invitees },
      { eventId: 'ev-1', subject: 'Daily Scrum', startAt: day(-1), endAt: day(-1, 30), cancelled: true, joinUrl: JOIN, invitees },
      { eventId: 'ev-0', subject: 'Daily Scrum', startAt: day(-4), endAt: day(-4, 30), cancelled: false, joinUrl: JOIN, invitees }, // no report
      { eventId: 'ev-future', subject: 'Daily Scrum', startAt: day(2), endAt: day(2, 30), cancelled: false, joinUrl: JOIN, invitees },
    ];
    records = {
      'rep-2': [
        { email: f.users.devA.email, totalSeconds: 1800, intervals: [interval(-2, 28, -2)] }, // on time
        { email: f.users.qaB.email, totalSeconds: 900, intervals: [interval(10, 20, -2), interval(22, 27, -2)] }, // late (joined 10 min)
        { email: f.users.devNone.email, totalSeconds: 300, intervals: [interval(1, 6, -2)] }, // short
        // admin: invited, never joined -> absent
        { email: 'guest@outside.example', totalSeconds: 1800, intervals: [interval(0, 30, -2)] },
        { email: f.users.pm.email, totalSeconds: 1800, intervals: [interval(0, 30, -2)] }, // not invited - ignored
      ],
      'rep-3': [{ email: f.users.devA.email, totalSeconds: 1500, intervals: [interval(2, 27, -3)] }],
    };
    setGraph();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  const turnOn = (extra: any = {}) =>
    http()
      .patch('/meeting-attendance/settings')
      .set(auth(f.users.admin))
      .send({
        meetingAttendanceEnabled: true,
        meetingAttendanceProjectIds: [f.projects.pLms],
        meetingOrganiserUserIds: [f.users.pm.id],
        meetingTrackedSeries: [{ organiserUserId: f.users.pm.id, seriesId: SERIES, subject: 'Daily Scrum' }],
        ...extra,
      })
      .expect(200);

  it('Import now: refused while C6 is off; nightly does nothing while off; only Admin/PM', async () => {
    const res = await http().post('/meeting-attendance/import').set(auth(f.users.admin)).expect(400);
    expect(res.body.message).toMatch(/Switch C6 on/);
    await importer.nightly();
    expect((await ds.query(`SELECT count(*)::int AS n FROM meeting_attendance_imports`))[0].n).toBe(0);
    for (const u of [f.users.devA, f.users.exec, f.users.clientA]) await http().post('/meeting-attendance/import').set(auth(u)).expect(403);
    expect(graph.listInstances).not.toHaveBeenCalled();
  });

  it('series picker: Admin only, organiser must be listed, lists their recurring meetings', async () => {
    await http().get(`/meeting-attendance/series?organiserUserId=${f.users.pm.id}`).set(auth(f.users.pm)).expect(403);
    let res = await http().get(`/meeting-attendance/series?organiserUserId=${f.users.pm.id}`).set(auth(f.users.admin)).expect(400);
    expect(res.body.message).toMatch(/organisers/);
    await http().patch('/meeting-attendance/settings').set(auth(f.users.admin)).send({ meetingOrganiserUserIds: [f.users.pm.id] }).expect(200);
    res = await http().get(`/meeting-attendance/series?organiserUserId=${f.users.pm.id}`).set(auth(f.users.admin)).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ seriesId: SERIES, subject: 'Daily Scrum', organiserUserId: f.users.pm.id, tracked: false })]);
    expect(graph.userId).toHaveBeenCalledWith(f.users.pm.email);
    // Teams refusing (access policy missing) gives a readable message.
    (graph.listSeries as jest.Mock).mockRejectedValueOnce(new MeetingGraphError('Microsoft Graph 403', 403));
    res = await http().get(`/meeting-attendance/series?organiserUserId=${f.users.pm.id}`).set(auth(f.users.admin)).expect(400);
    expect(res.body.message).toMatch(/Tracker-C6 access policy/);
  });

  it('imports ended meetings: outcomes per invitee, cancelled and no-report kept, guests and non-invitees ignored; audited', async () => {
    await turnOn();
    const res = await http().post('/meeting-attendance/import').set(auth(f.users.pm)).expect(201);
    expect(res.body).toMatchObject({ status: 'done', meetingsFound: 4, reportsRead: 2, rowsWritten: 8, error: null });
    const occ = await ds.query(`SELECT "eventId", status, "invitedCount", "reportId" FROM meeting_occurrences ORDER BY "startAt"`);
    expect(occ).toEqual([
      { eventId: 'ev-0', status: 'no_report', invitedCount: 4, reportId: null },
      { eventId: 'ev-3', status: 'imported', invitedCount: 4, reportId: 'rep-3' },
      { eventId: 'ev-2', status: 'imported', invitedCount: 4, reportId: 'rep-2' },
      { eventId: 'ev-1', status: 'cancelled', invitedCount: 0, reportId: null },
    ]);
    const rows = await ds.query(
      `SELECT o."eventId", a."userId", a.outcome, a."attendedSeconds" FROM meeting_attendance a JOIN meeting_occurrences o ON o.id = a."occurrenceId" ORDER BY o."eventId", a."userId"`,
    );
    const by = (ev: string, u: FixtureUser) => rows.find((r: any) => r.eventId === ev && r.userId === u.id);
    expect(by('ev-2', f.users.devA).outcome).toBe('on_time');
    expect(by('ev-2', f.users.qaB)).toMatchObject({ outcome: 'late', attendedSeconds: 900 });
    expect(by('ev-2', f.users.devNone).outcome).toBe('short');
    expect(by('ev-2', f.users.admin).outcome).toBe('absent');
    expect(by('ev-2', f.users.pm)).toBeUndefined();
    expect(by('ev-3', f.users.devA).outcome).toBe('on_time');
    expect(rows.filter((r: any) => r.eventId === 'ev-3')).toHaveLength(4); // the other three absent
    expect(rows.some((r: any) => r.userId === f.users.clientA.id)).toBe(false);
    const log = await ds.query(`SELECT trigger, status, "userId" FROM meeting_attendance_imports`);
    expect(log).toEqual([{ trigger: 'manual', status: 'done', userId: f.users.pm.id }]);
    const audit = await ds.query(`SELECT "userId" FROM audit_logs WHERE action = $1`, [MEETING_ATTENDANCE_AUDIT.IMPORT_RUN]);
    expect(audit).toEqual([{ userId: f.users.pm.id }]);
    // The page lists the run.
    const page = await http().get('/meeting-attendance/settings').set(auth(f.users.pm)).expect(200);
    expect(page.body.imports[0]).toMatchObject({ trigger: 'manual', status: 'done', meetingsFound: 4 });
  });

  it('re-import refreshes times and outcomes but keeps an Excused mark, and never loses a report already read', async () => {
    await ds.query(
      `UPDATE meeting_attendance SET excused = true, "excuseReason" = 'Sick', "excusedByUserId" = $1, "excusedAt" = now() WHERE "userId" = $2 AND "occurrenceId" = (SELECT id FROM meeting_occurrences WHERE "eventId" = 'ev-2')`,
      [f.users.pm.id, f.users.admin.id],
    );
    records['rep-2'].push({ email: f.users.admin.email, totalSeconds: 1700, intervals: [interval(0, 29, -2)] });
    (graph.listReports as jest.Mock).mockImplementationOnce(async () => [{ reportId: 'rep-2', startAt: day(-2, -4), endAt: day(-2, 31) }]); // rep-3 expired
    const r = await importer.run(f.tenants.t1, 'nightly');
    expect(r.status).toBe('done');
    const [row] = await ds.query(
      `SELECT a.outcome, a.excused, a."excuseReason" FROM meeting_attendance a JOIN meeting_occurrences o ON o.id = a."occurrenceId" WHERE o."eventId" = 'ev-2' AND a."userId" = $1`,
      [f.users.admin.id],
    );
    expect(row).toEqual({ outcome: 'on_time', excused: true, excuseReason: 'Sick' });
    const [ev3] = await ds.query(`SELECT status FROM meeting_occurrences WHERE "eventId" = 'ev-3'`);
    expect(ev3.status).toBe('imported');
    expect((await ds.query(`SELECT count(*)::int AS n FROM meeting_occurrences`))[0].n).toBe(4);
  });

  it('a Graph error on one series is recorded as a failed import; other series still import', async () => {
    await turnOn({
      meetingTrackedSeries: [
        { organiserUserId: f.users.pm.id, seriesId: 'AAMk-broken', subject: 'Friday call' },
        { organiserUserId: f.users.pm.id, seriesId: SERIES, subject: 'Daily Scrum' },
      ],
    });
    const real = graph.listInstances as jest.Mock;
    real.mockImplementation(async (_a: string, seriesId: string) => {
      if (seriesId === 'AAMk-broken') throw new MeetingGraphError('Microsoft Graph 404 on /events', 404);
      return instances;
    });
    const res = await http().post('/meeting-attendance/import').set(auth(f.users.admin)).expect(201);
    expect(res.body.status).toBe('failed');
    expect(res.body.error).toMatch(/Friday call.*404/);
    expect(res.body.meetingsFound).toBe(4);
  });

  it('pure rules: reports matched to the right meeting; repeat records added up', () => {
    const inst = { startAt: day(-2), endAt: day(-2, 30) };
    const reps = [
      { reportId: 'early', startAt: day(-2, -31), endAt: day(-2, 30) },
      { reportId: 'a', startAt: day(-2, -30), endAt: day(-2, 30) },
      { reportId: 'b', startAt: day(-2, 15), endAt: day(-2, 30) },
      { reportId: 'after', startAt: day(-2, 30), endAt: day(-2, 40) },
    ];
    expect(reportsForInstance(inst, reps).map((r) => r.reportId)).toEqual(['a', 'b']);
    const rows = attendanceRows(
      { ...inst, invitees: ['x@t', 'x@t', 'y@t'] },
      [
        { email: 'x@t', totalSeconds: 600, intervals: [interval(8, 18, -2)] },
        { email: 'x@t', totalSeconds: 600, intervals: [interval(19, 29, -2)] },
      ],
      new Map([['x@t', 1], ['y@t', 2]]),
      { lateMinutes: 5, minStayPercent: 50 },
    );
    expect(rows).toEqual([
      expect.objectContaining({ userId: 1, attendedSeconds: 1200, outcome: 'late', firstJoinAt: day(-2, 8), lastLeaveAt: day(-2, 29) }),
      expect.objectContaining({ userId: 2, attendedSeconds: 0, outcome: 'absent', firstJoinAt: null }),
    ]);
  });
});
