import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { dateInZone, startOfDayInZone } from '../src/team-settings/time-zone';
import { addCalendarDays } from '../src/performance-metrics/working-days';
import { mondayOf } from '../src/weekly-status/weekly-status';
import { TrackingMetricsService } from '../src/performance-tracking/metrics/tracking-metrics.service';
import { WEEKLY_FIGURES_AUDIT } from '../src/performance-tracking/scorecard/weekly-figures.service';

// Weekly figures (2026-11-24, the user's decisions): Programme Manager ONLY
// (403 for Admin, Executive, Developer, Designer, DevOps, QA); own tracked
// projects only; completed Monday-Sunday weeks from 02-11-2026; RAW values
// with the nightly definitions over 7 days; QA listed with C6 only; "n/a"
// and "fewer than N items"; evidence per metric; Excel; everything audited.
describe('Weekly figures (PM only, e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;
  let taskId: number;
  const extra: Record<string, FixtureUser> = {};
  const ZONE = 'Africa/Addis_Ababa';
  const lastMonday = addCalendarDays(mondayOf(dateInZone(new Date(), ZONE)), -7);
  const at = (dayOffset: number, hhmm: string) => new Date(startOfDayInZone(addCalendarDays(lastMonday, dayOffset), ZONE).getTime() + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000);
  const ddmmyyyy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const binary = (u: FixtureUser, url: string) =>
    get(u, url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  const audits = (action: string) => ds.query(`SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`, [action]);
  const addUser = async (key: string, role: string, projects: number[], email = `${key}@test.local`) => {
    const [row] = await ds.query(`INSERT INTO users ("tenantId", email, "passwordHash", "fullName", role) VALUES ($1, $2, 'x', $3, $4) RETURNING id`, [f.tenants.t1, email, `Name ${key}`, role]);
    for (const p of projects) await ds.query(`INSERT INTO user_projects ("usersId", "projectsId") VALUES ($1, $2)`, [row.id, p]);
    extra[key] = { id: row.id, email, tenantId: f.tenants.t1, role };
  };
  const cell = (p: any, metric: string) => p.cells.find((c: any) => c.metric === metric);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(
      `TRUNCATE project_tasks, task_qa_reviews, task_status_events, task_commitment_events, task_flags, task_chases, task_progress_notes,
                performance_metric_snapshots, performance_metric_runs, performance_tracking_settings, audit_logs,
                meeting_attendance_imports, meeting_attendance, meeting_occurrences RESTART IDENTITY CASCADE`,
    );
    await addUser('designer', 'designer', [f.projects.pLms]);
    await addUser('devops', 'devops', [f.projects.pLms]);
    await addUser('pmOther', 'program_manager', [f.projects.pA]);
    await addUser('devElsewhere', 'developer', [f.projects.pA]);
    await addUser('hidden', 'developer', [f.projects.pLms], 'test.weekly@vistoria-test.invalid');
    await ds.query(`UPDATE projects SET "performanceTrackingEnabled" = true, "performanceTrackingSince" = '2026-11-02T00:00:00Z' WHERE id = $1`, [f.projects.pLms]);
    const [mod] = await ds.query(`SELECT id FROM modules WHERE "projectId" = $1`, [f.projects.pLms]);
    const [phase] = await ds.query(`INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", name) VALUES ($1, $2, 'LMS', $3, 'LMS Module', 'Build') RETURNING id`, [f.tenants.t1, f.projects.pLms, mod.id]);
    const task = async (title: string, u: FixtureUser) =>
      (
        await ds.query(
          `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", title, description, status, "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
           VALUES ($1, $2, 'LMS', $3, 'LMS Module', $4, 'Build', $5, 'x', 'Pass', $6, $7, $8, $9) RETURNING id`,
          [f.tenants.t1, f.projects.pLms, mod.id, phase.id, title, u.id, u.email, f.users.pm.id, f.users.pm.email],
        )
      )[0].id as number;
    // devA: one task submitted to QA on Tuesday, approved first time on Wednesday.
    taskId = await task('Weekly task one', f.users.devA);
    await ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", resolution, "submittedByUserId", "submittedByEmail", status, "reviewType", "submittedAt", "reviewedAt")
       VALUES ($1, $2, 1, 'done', $3, $4, 'approved', 'qa', $5, $6)`,
      [f.tenants.t1, taskId, f.users.devA.id, f.users.devA.email, at(1, '10:00'), at(2, '11:00')],
    );
    // A hidden test account with its own task: never listed.
    await task('Hidden task', extra.hidden);
    // C6 on for LMS: five stand-ups Mon-Fri; devA 4 on time + 1 late, qaB absent.
    await http()
      .patch('/meeting-attendance/settings')
      .set(auth(f.users.admin))
      .send({
        meetingAttendanceEnabled: true,
        meetingAttendanceProjectIds: [f.projects.pLms],
        meetingOrganiserUserIds: [f.users.pm.id],
        meetingTrackedSeries: [{ organiserUserId: f.users.pm.id, seriesId: 'AAMk-scrum', subject: 'Daily Scrum' }],
      })
      .expect(200);
    for (let d = 0; d < 5; d++) {
      const [occ] = await ds.query(
        `INSERT INTO meeting_occurrences ("tenantId", "organiserUserId", "seriesId", "eventId", subject, "startAt", "endAt", status, "invitedCount")
         VALUES ($1, $2, 'AAMk-scrum', $3, 'Daily Scrum', $4, $5, 'imported', 2) RETURNING id`,
        [f.tenants.t1, f.users.pm.id, `ev-${d}`, at(d, '10:00'), at(d, '10:30')],
      );
      await ds.query(`INSERT INTO meeting_attendance ("tenantId", "occurrenceId", "userId", "attendedSeconds", outcome) VALUES ($1, $2, $3, 1500, $4)`, [f.tenants.t1, occ.id, f.users.devA.id, d === 4 ? 'late' : 'on_time']);
      await ds.query(`INSERT INTO meeting_attendance ("tenantId", "occurrenceId", "userId", "attendedSeconds", outcome) VALUES ($1, $2, $3, 0, 'absent')`, [f.tenants.t1, occ.id, f.users.qaB.id]);
    }
    await ds.query(`TRUNCATE audit_logs RESTART IDENTITY`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a Programme Manager sees last week for their tracked project by default, raw values, audited', async () => {
    const body = (await get(f.users.pm, '/performance-tracking/scorecard/weekly').expect(200)).body;
    expect(body.week).toEqual({ monday: lastMonday, sunday: addCalendarDays(lastMonday, 6) });
    expect(body.project).toEqual({ id: f.projects.pLms, name: 'LMS' });
    expect(body.choices.projects).toEqual([{ id: f.projects.pLms, name: 'LMS' }]);
    expect(body.choices.weeks[0]).toBe(lastMonday);
    expect(body.choices.weeks[body.choices.weeks.length - 1]).toBe('2026-11-02');
    expect(body.groups.map((g: any) => g.metrics).flat()).toEqual(['D1', 'D2', 'D3', 'D4', 'Q1', 'Q2', 'Q3', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'O1', 'O2', 'O3', 'O4', 'O5', 'L1', 'L2']);
    const dev = body.people.find((p: any) => p.userId === f.users.devA.id);
    // One first-time pass: 100%, but fewer than 5 items. No scores anywhere.
    expect(cell(dev, 'Q1')).toMatchObject({ value: 100, numerator: 1, denominator: 1, sample: 1, state: 'small' });
    expect(cell(dev, 'C4')).toMatchObject({ value: null, state: 'na' });
    expect(cell(dev, 'C2')).toMatchObject({ value: 0, state: 'ok' });
    expect(cell(dev, 'C6')).toMatchObject({ value: 80, numerator: 4, denominator: 5, state: 'ok' });
    expect(JSON.stringify(body)).not.toMatch(/"score"/);
    // QA separately, C6 only.
    expect(body.people.map((p: any) => p.userId)).not.toContain(f.users.qaB.id);
    const qa = body.qa.find((p: any) => p.userId === f.users.qaB.id);
    expect(cell(qa, 'C6')).toMatchObject({ value: 0, numerator: 0, denominator: 5, state: 'ok' });
    expect(cell(qa, 'Q1')).toMatchObject({ state: 'na' });
    // Project members only (C3 alone would list every developer); hidden test accounts never.
    expect(body.people.map((p: any) => p.userId)).toContain(f.users.devNone.id);
    expect(body.people.map((p: any) => p.userId)).not.toContain(extra.devElsewhere.id);
    // Hidden test accounts never appear.
    expect([...body.people, ...body.qa].map((p: any) => p.userId)).not.toContain(extra.hidden.id);
    const [a] = await audits(WEEKLY_FIGURES_AUDIT.VIEWED);
    expect(a).toMatchObject({ userId: f.users.pm.id, entityType: 'Project', entityId: f.projects.pLms });
    expect(JSON.parse(a.details)).toMatchObject({ week: lastMonday, project: 'LMS' });
  });

  it('everyone else gets 403 on every route - Admin, Executive, Developer, Designer, DevOps, QA', async () => {
    const who = [f.users.admin, f.users.exec, f.users.devA, extra.designer, extra.devops, f.users.qaB];
    for (const u of who) {
      await get(u, '/performance-tracking/scorecard/weekly').expect(403);
      await get(u, `/performance-tracking/scorecard/weekly/people/${f.users.devA.id}`).expect(403);
      await get(u, '/performance-tracking/scorecard/weekly/export').expect(403);
    }
    await get(f.users.clientA, '/performance-tracking/scorecard/weekly').expect(403);
  });

  it("own projects only: another PM sees nothing and gets 403 asking for LMS", async () => {
    const body = (await get(extra.pmOther, '/performance-tracking/scorecard/weekly').expect(200)).body;
    expect(body.project).toBeNull();
    expect(body.people).toEqual([]);
    await get(extra.pmOther, `/performance-tracking/scorecard/weekly?projectId=${f.projects.pLms}`).expect(403);
    await get(extra.pmOther, `/performance-tracking/scorecard/weekly/people/${f.users.devA.id}?projectId=${f.projects.pLms}`).expect(403);
    await get(extra.pmOther, `/performance-tracking/scorecard/weekly/export?projectId=${f.projects.pLms}`).expect(403);
    await get(f.users.pmT2, '/performance-tracking/scorecard/weekly').expect(200);
    await get(f.users.pmT2, `/performance-tracking/scorecard/weekly?projectId=${f.projects.pLms}`).expect(403);
  });

  it('completed weeks only, from 02-11-2026', async () => {
    const thisMonday = addCalendarDays(lastMonday, 7);
    await get(f.users.pm, `/performance-tracking/scorecard/weekly?week=${thisMonday}`).expect(400);
    await get(f.users.pm, '/performance-tracking/scorecard/weekly?week=2026-10-26').expect(400);
    await get(f.users.pm, `/performance-tracking/scorecard/weekly?week=${addCalendarDays(lastMonday, 1)}`).expect(400);
    await get(f.users.pm, '/performance-tracking/scorecard/weekly?week=nope').expect(400);
    await get(f.users.pm, '/performance-tracking/scorecard/weekly?week=2026-11-02').expect(200);
  });

  it('a person: each metric with its evidence (tasks counted, with titles; stand-ups), audited', async () => {
    const body = (await get(f.users.pm, `/performance-tracking/scorecard/weekly/people/${f.users.devA.id}`).expect(200)).body;
    expect(body.person).toMatchObject({ userId: f.users.devA.id, qa: false });
    const q1 = body.metrics.find((m: any) => m.metric === 'Q1');
    expect(q1.details.countedTaskIds).toEqual([taskId]);
    expect(body.taskTitles[taskId]).toBe('Weekly task one');
    const c6 = body.metrics.find((m: any) => m.metric === 'C6');
    expect(c6.details.meetings.map((m: any) => m.outcome)).toEqual(['on_time', 'on_time', 'on_time', 'on_time', 'late']);
    const [a] = await audits(WEEKLY_FIGURES_AUDIT.PERSON_VIEWED);
    expect(a.userId).toBe(f.users.pm.id);
    expect(JSON.parse(a.details)).toMatchObject({ week: lastMonday, personUserId: f.users.devA.id });
    // Not in this project (or a hidden test account): 404.
    await get(f.users.pm, `/performance-tracking/scorecard/weekly/people/${extra.devElsewhere.id}`).expect(404);
    await get(f.users.pm, `/performance-tracking/scorecard/weekly/people/${extra.hidden.id}`).expect(404);
  });

  it('Excel export: PM only, raw values with "fewer than 5 items", audited', async () => {
    const res = await binary(f.users.pm, '/performance-tracking/scorecard/weekly/export').expect(200);
    expect(res.headers['content-disposition']).toContain(`weekly-figures-lms-${ddmmyyyy(lastMonday)}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.getWorksheet('Weekly figures')!;
    const header = (ws.getRow(1).values as any[]).slice(1);
    const devRow = ws.getRows(2, ws.rowCount - 1)!.find((r) => r.getCell(1).value === 'Name devA')!;
    expect(devRow.getCell(header.indexOf('Q1') + 1).value).toBe('100% (1/1) - fewer than 5 items');
    expect(devRow.getCell(header.indexOf('C4') + 1).value).toBe('n/a');
    expect(devRow.getCell(header.indexOf('C6') + 1).value).toBe('80% (4/5)');
    expect(wb.getWorksheet('Evidence')).toBeTruthy();
    const [a] = await audits(WEEKLY_FIGURES_AUDIT.EXPORTED);
    expect(a.userId).toBe(f.users.pm.id);
  });

  it('the nightly run stores the same details as before (no evidence lists)', async () => {
    const service = app.get(TrackingMetricsService);
    const sunday = addCalendarDays(lastMonday, 6);
    const r = await service.runTenant(f.tenants.t1, { trigger: 'manual', snapshotDate: sunday });
    expect(r.status).toBe('done');
    const rows = await ds.query(`SELECT details FROM performance_metric_snapshots WHERE "snapshotDate" = $1 AND "userId" = $2`, [sunday, f.users.devA.id]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      expect(d).not.toHaveProperty('countedTaskIds');
      expect(d).not.toHaveProperty('items.0.workingHours');
    }
  });
});
