import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { MEETING_ATTENDANCE_AUDIT, applyC6, c6Summary } from '../src/meeting-attendance/meeting-attendance';
import { dateInZone } from '../src/team-settings/time-zone';

// C6 meeting attendance, Stage 3 (2026-11-11): Excused marking (decision
// 6) and the C6 row on the scorecard - shown only (decision 4) unless the
// separate "count C6 in scores" switch is on.
describe('C6 meeting attendance - Excused and scorecard row (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const today = dateInZone(new Date(), 'Africa/Addis_Ababa');
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCHours(6, 0, 0, 0);
    return new Date(d.getTime() + offset * 86_400_000);
  };
  const settings = (body: any) => http().patch('/meeting-attendance/settings').set(auth(f.users.admin)).send(body).expect(200);

  // devA: 3 on time, 1 late, 1 absent, plus one outside the 28-day window
  // and a meeting Teams has no report for. qaB: 1 absent.
  let occ: Record<string, number> = {};
  let att: Record<string, number> = {};
  const meeting = async (key: string, offset: number, status = 'imported') => {
    const [row] = await ds.query(
      `INSERT INTO meeting_occurrences ("tenantId", "organiserUserId", "seriesId", "eventId", subject, "startAt", "endAt", status, "invitedCount")
       VALUES ($1, $2, 'AAMk-scrum', $3, 'Daily Scrum', $4, $5, $6, 2) RETURNING id`,
      [f.tenants.t1, f.users.pm.id, `ev-${key}`, day(offset), new Date(day(offset).getTime() + 30 * 60_000), status],
    );
    occ[key] = row.id;
  };
  const person = async (key: string, meetingKey: string, u: FixtureUser, outcome: string) => {
    const [row] = await ds.query(
      `INSERT INTO meeting_attendance ("tenantId", "occurrenceId", "userId", "attendedSeconds", outcome) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [f.tenants.t1, occ[meetingKey], u.id, outcome === 'absent' ? 0 : 1500, outcome],
    );
    att[key] = row.id;
  };
  const snapshot = (u: FixtureUser, projectId: number, phase: 'baseline' | 'scoring') =>
    ds.query(
      `INSERT INTO performance_metric_snapshots ("tenantId", "snapshotDate", "projectId", "userId", metric, phase, value, numerator, denominator, sample, "enoughData", "windowFrom", details, "runId")
       VALUES ($1, $2, $3, $4, 'C1', $5, 100, 10, 10, 10, true, $2, '{}', 1)`,
      [f.tenants.t1, today, projectId, u.id, phase],
    );

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE audit_logs, performance_tracking_settings, meeting_attendance_imports, meeting_attendance, meeting_occurrences, performance_metric_snapshots, performance_score_overrides RESTART IDENTITY CASCADE`,
    );
    for (const [k, o] of [['m1', -2], ['m2', -3], ['m3', -4], ['m4', -5], ['m5', -6], ['old', -40]] as const) await meeting(k, o);
    await meeting('noreport', -7, 'no_report');
    await person('a1', 'm1', f.users.devA, 'on_time');
    await person('a2', 'm2', f.users.devA, 'on_time');
    await person('a3', 'm3', f.users.devA, 'on_time');
    await person('a4', 'm4', f.users.devA, 'late');
    await person('a5', 'm5', f.users.devA, 'absent');
    await person('aOld', 'old', f.users.devA, 'absent');
    await person('q1', 'm1', f.users.qaB, 'absent');
    await person('pm1', 'm1', f.users.pm, 'absent');
    await person('ex1', 'm1', f.users.exec, 'absent'); // shares no project with the PM
    await person('ad1', 'm2', f.users.admin, 'late');
    await snapshot(f.users.devA, f.projects.pLms, 'scoring');
    await snapshot(f.users.qaB, f.projects.pLms, 'baseline');
    await snapshot(f.users.devNone, f.projects.pA, 'scoring'); // not a C6 project
  });

  afterAll(async () => {
    await app?.close();
  });

  const card = async (u: FixtureUser) => {
    const res = await http().get(`/performance-tracking/scorecard/people/${u.id}`).set(auth(f.users.pm)).expect(200);
    return res.body.card;
  };
  const c6Of = (c: any) => c.metrics.find((m: any) => m.metric === 'C6');

  it('C6 off: no C6 row anywhere, scores untouched', async () => {
    const c = await card(f.users.devA);
    expect(c6Of(c)).toBeUndefined();
    expect(c.competencies.find((x: any) => x.key === 'C').score).toBe(5);
    const list = await http().get('/performance-tracking/scorecard').set(auth(f.users.pm)).expect(200);
    expect(list.body.metricInfo.some((m: any) => m.metric === 'C6')).toBe(false);
    expect(list.body.c6).toBeNull();
  });

  it('C6 on, not counted: shown with its breakdown, never changes the scores', async () => {
    await settings({
      meetingAttendanceEnabled: true,
      meetingAttendanceProjectIds: [f.projects.pLms],
      meetingOrganiserUserIds: [f.users.pm.id],
      meetingTrackedSeries: [{ organiserUserId: f.users.pm.id, seriesId: 'AAMk-scrum', subject: 'Daily Scrum' }],
    });
    const c = await card(f.users.devA);
    expect(c6Of(c)).toMatchObject({ state: 'not_scored', value: 60, sample: 5, numerator: 3, denominator: 5, score: null, breakdown: { onTime: 3, late: 1, short: 0, absent: 1, excused: 0 } });
    expect(c.metrics.findIndex((m: any) => m.metric === 'C6')).toBe(c.metrics.findIndex((m: any) => m.metric === 'C5') + 1);
    expect(c.competencies.find((x: any) => x.key === 'C').score).toBe(5);
    expect(c.overall).toBe(5);
    // Baseline project -> Baseline; not in a C6 project -> no row.
    expect(c6Of(await card(f.users.qaB))).toMatchObject({ state: 'baseline', value: null });
    expect(c6Of(await card(f.users.devNone))).toBeUndefined();
    const list = await http().get('/performance-tracking/scorecard').set(auth(f.users.pm)).expect(200);
    expect(list.body.metricInfo.find((m: any) => m.metric === 'C6')).toMatchObject({ label: 'Meeting attendance', scored: false });
    expect(list.body.competencies.find((x: any) => x.key === 'C').metrics).toContain('C6');
    // A developer sees it on their own card.
    const own = await http().get(`/performance-tracking/scorecard/people/${f.users.devA.id}`).set(auth(f.users.devA)).expect(200);
    expect(c6Of(own.body.card).value).toBe(60);
  });

  it('Excused: PM only by default, not their own, not on-time rows, reason from the list; audited', async () => {
    const ex = (u: FixtureUser, id: number, body: any = { reason: 'Sick' }) => http().post(`/meeting-attendance/attendance/${id}/excuse`).set(auth(u)).send(body);
    await ex(f.users.devA, att.a5).expect(403);
    await ex(f.users.exec, att.a5).expect(403);
    await ex(f.users.pm, att.ex1).expect(403); // not on any of the PM's projects
    await ex(f.users.admin, att.ad1).expect(403); // Admin: not their own either
    await ex(f.users.pm, att.pm1).expect(403); // own
    expect((await ex(f.users.pm, att.a1).expect(400)).body.message).toMatch(/on time/);
    expect((await ex(f.users.pm, att.a5, { reason: 'Holiday' }).expect(400)).body.message).toMatch(/Leave, Sick, Client call/);
    await ex(f.users.pm, att.a5, { reason: 'sick', note: '  Doctor note  ' }).expect(201);
    expect((await ex(f.users.pm, att.a5).expect(400)).body.message).toMatch(/Already excused/);
    const [row] = await ds.query(`SELECT excused, "excuseReason", "excuseNote", "excusedByUserId" FROM meeting_attendance WHERE id = $1`, [att.a5]);
    expect(row).toEqual({ excused: true, excuseReason: 'Sick', excuseNote: 'Doctor note', excusedByUserId: f.users.pm.id });
    const audit = await ds.query(`SELECT "userId", details FROM audit_logs WHERE action = $1`, [MEETING_ATTENDANCE_AUDIT.EXCUSED]);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details)).toMatchObject({ attendanceId: att.a5, userId: f.users.devA.id, outcome: 'absent', reason: 'Sick' });
    // Excused never counts either way: 3 on time of 4.
    expect(c6Of(await card(f.users.devA))).toMatchObject({ value: 75, sample: 4, breakdown: { onTime: 3, late: 1, absent: 0, excused: 1 } });
    // The meeting list shows it.
    const list = await http().get('/meeting-attendance/meetings').set(auth(f.users.pm)).expect(200);
    expect(list.body.canExcuse).toBe(true);
    const m5 = list.body.meetings.find((m: any) => m.id === occ.m5);
    expect(m5.attendance[0]).toMatchObject({ excused: true, excuseReason: 'Sick', excusedByName: 'Name pm' });
    expect(list.body.meetings.some((m: any) => m.id === occ.old)).toBe(false); // older than 28 days
  });

  it('an Admin can excuse anyone (whatever the roles setting); a PM sees which rows they can excuse', async () => {
    await http().post(`/meeting-attendance/attendance/${att.ex1}/excuse`).set(auth(f.users.admin)).send({ reason: 'Client call' }).expect(201);
    await http().delete(`/meeting-attendance/attendance/${att.ex1}/excuse`).set(auth(f.users.pm)).expect(403);
    const list = await http().get('/meeting-attendance/meetings').set(auth(f.users.pm)).expect(200);
    const m1 = list.body.meetings.find((m: any) => m.id === occ.m1).attendance;
    const can = (u: FixtureUser) => m1.find((a: any) => a.userId === u.id).canExcuse;
    expect([can(f.users.devA), can(f.users.qaB), can(f.users.exec), can(f.users.pm)]).toEqual([true, true, false, false]);
    const adminList = await http().get('/meeting-attendance/meetings').set(auth(f.users.admin)).expect(200);
    expect(adminList.body.canExcuse).toBe(true);
    await http().delete(`/meeting-attendance/attendance/${att.ex1}/excuse`).set(auth(f.users.admin)).expect(200);
    // Admin is no longer a choice in the setting.
    await http().patch('/meeting-attendance/settings').set(auth(f.users.admin)).send({ meetingExcuseRoles: ['admin'] }).expect(400);
  });

  it('removing an Excused mark: same roles, audited; the meeting counts again', async () => {
    await http().delete(`/meeting-attendance/attendance/${att.a5}/excuse`).set(auth(f.users.devA)).expect(403);
    await http().delete(`/meeting-attendance/attendance/${att.a5}/excuse`).set(auth(f.users.pm)).expect(200);
    await http().delete(`/meeting-attendance/attendance/${att.a5}/excuse`).set(auth(f.users.pm)).expect(400);
    const audit = await ds.query(`SELECT details FROM audit_logs WHERE action = $1 AND "entityId" = $2`, [MEETING_ATTENDANCE_AUDIT.EXCUSE_REMOVED, att.a5]);
    expect(JSON.parse(audit[0].details).was).toMatchObject({ reason: 'Sick', by: f.users.pm.id });
    expect(c6Of(await card(f.users.devA))).toMatchObject({ value: 60, sample: 5 });
  });

  it('Executives get the page and Excused only when the setting allows them', async () => {
    await http().get('/meeting-attendance/meetings').set(auth(f.users.exec)).expect(403);
    await settings({ meetingExcuseRoles: ['program_manager', 'executive'] });
    const res = await http().get('/meeting-attendance/meetings').set(auth(f.users.exec)).expect(200);
    expect(res.body.canExcuse).toBe(true);
    await http().get('/meeting-attendance/settings').set(auth(f.users.exec)).expect(200);
    await http().patch('/meeting-attendance/settings').set(auth(f.users.exec)).send({ meetingLateMinutes: 9 }).expect(403);
    await http().post('/meeting-attendance/import').set(auth(f.users.exec)).expect(403);
    await http().post(`/meeting-attendance/attendance/${att.q1}/excuse`).set(auth(f.users.exec)).send({ reason: 'Leave' }).expect(201);
    await settings({ meetingExcuseRoles: ['program_manager'] });
    await http().get('/meeting-attendance/meetings').set(auth(f.users.exec)).expect(403);
  });

  it('below the minimum sample: Not enough data', async () => {
    await settings({ meetingMinSample: 6 });
    expect(c6Of(await card(f.users.devA))).toMatchObject({ state: 'not_enough_data', value: 60, score: null });
    await settings({ meetingMinSample: 4 });
  });

  it('"Count C6 in scores" on: banded and joins Collaboration and the overall', async () => {
    await settings({ meetingCountInScores: true });
    const c = await card(f.users.devA);
    // 60% -> band 2 (bands 95/85/70/50); C = (C1 5 + C6 2) / 2.
    expect(c6Of(c)).toMatchObject({ state: 'scored', score: 2, computedScore: 2 });
    expect(c.competencies.find((x: any) => x.key === 'C').score).toBe(3.5);
    expect(c.overall).toBe(3.5);
    // C6 cannot be overridden (not a nightly metric).
    const o = await http().post('/performance-tracking/scorecard/overrides').set(auth(f.users.admin)).send({ userId: f.users.devA.id, metric: 'C6', score: 5, reason: 'Testing a C6 override' });
    expect([400, 403]).toContain(o.status);
    await settings({ meetingCountInScores: false });
  });

  it('pure: applyC6 leaves a card alone when not counted; c6Summary ignores excused', () => {
    const base = { state: 'scored' as const, overall: 4, competencies: [{ key: 'C', label: 'Collaboration', score: 4 }], metrics: [{ metric: 'C5', score: 4 }] };
    const s = c6Summary([
      { outcome: 'on_time', excused: false },
      { outcome: 'short', excused: false },
      { outcome: 'absent', excused: true },
    ]);
    expect(s).toEqual({ value: 50, numerator: 1, denominator: 2, sample: 2, details: { onTime: 1, late: 0, short: 1, absent: 0, excused: 1 } });
    const out = applyC6(base, s, { phase: 'scoring', minSample: 1, countInScores: false, percentBands: [95, 85, 70, 50], projects: [1] });
    expect(out.overall).toBe(4);
    expect(out.competencies).toEqual(base.competencies);
    expect(out.metrics.map((m) => m.metric)).toEqual(['C5', 'C6']);
    expect(c6Summary([]).value).toBeNull();
  });
});
