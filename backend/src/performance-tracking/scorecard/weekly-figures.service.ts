import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { User, UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { PerformanceMetricsService } from '../../performance-metrics/performance-metrics.service';
import { addCalendarDays } from '../../performance-metrics/working-days';
import { dateInZone, startOfDayInZone } from '../../team-settings/time-zone';
import { mondayOf } from '../../weekly-status/weekly-status';
import { MeetingAttendanceService } from '../../meeting-attendance/meeting-attendance.service';
import { C6_INFO } from '../../meeting-attendance/meeting-attendance';
import { METRIC_INFO, TrackingMetric, TrackingMetricRow } from '../metrics/tracking-metrics';
import { TrackingMetricsService } from '../metrics/tracking-metrics.service';
import { hiddenFromScorecard } from './scorecard.service';

// Weekly figures (2026-11-24, the user's decisions): a Programme Manager
// ONLY view of each person's RAW metric values for one completed Monday-
// Sunday week (from 02-11-2026) in one of the PM's own tracked projects -
// the same definitions as the nightly metrics, computed live over a 7-day
// window, nothing stored. No 1-5 scores. QA people are listed separately
// with C6 only (the nightly metrics cover developer-type roles). Every
// view, person view and export is audited.
export const WEEKLY_FIGURES_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER];
export const WEEKLY_FIGURES_FIRST_WEEK = '2026-11-02';
export const WEEKLY_FIGURES_AUDIT = {
  VIEWED: 'performance_weekly_figures_viewed',
  PERSON_VIEWED: 'performance_weekly_figures_person_viewed',
  EXPORTED: 'performance_weekly_figures_exported',
} as const;

type WeeklyMetric = TrackingMetric | 'C6';
export const WEEKLY_GROUPS: Array<{ key: string; label: string; metrics: WeeklyMetric[] }> = [
  { key: 'D', label: 'Delivery', metrics: ['D1', 'D2', 'D3', 'D4'] },
  { key: 'Q', label: 'Quality', metrics: ['Q1', 'Q2', 'Q3'] },
  { key: 'C', label: 'Collaboration', metrics: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] },
  { key: 'O', label: 'Ownership', metrics: ['O1', 'O2', 'O3', 'O4', 'O5'] },
  { key: 'L', label: 'Client focus', metrics: ['L1', 'L2'] },
];
const METRICS: WeeklyMetric[] = WEEKLY_GROUPS.flatMap((g) => g.metrics);
const infoOf = (m: WeeklyMetric) => (m === 'C6' ? C6_INFO : { metric: m, ...METRIC_INFO[m] });

// ok = a value with enough data; small = a value from fewer items than the
// minimum ("fewer than N items"); na = no data; off = C6 not on for the project.
export type CellState = 'ok' | 'small' | 'na' | 'off';
export interface WeeklyCell {
  metric: WeeklyMetric;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  sample: number;
  state: CellState;
  // C1 only: median working hours to the first reply.
  medianWorkingHours?: number | null;
  targetWorkingHours?: number | null;
}

type Viewer = Pick<User, 'id' | 'email' | 'role' | 'tenantId'>;

export function cellState(unit: string, value: number | null, sample: number, enoughData: boolean): CellState {
  // A count with nothing behind it is a real 0 (no wait caused, no re-commits).
  if (unit === 'count' && sample === 0) return value === null ? 'na' : 'ok';
  if (value === null) return 'na';
  return enoughData ? 'ok' : 'small';
}

// DD-MM-YYYY (the user's date format).
export const ddmmyyyy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

@Injectable()
export class WeeklyFiguresService {
  constructor(
    private trackingMetrics: TrackingMetricsService,
    private metrics: PerformanceMetricsService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private meetingAttendance: MeetingAttendanceService,
    private dataSource: DataSource,
  ) {}

  private assertPm(viewer: Viewer) {
    if (!WEEKLY_FIGURES_ROLES.includes(viewer.role)) throw new ForbiddenException('Weekly figures are for Programme Managers only.');
  }

  // Completed Monday-Sunday weeks, newest first, from the first week.
  async weeks(tenantId: number, now = new Date()): Promise<string[]> {
    const { timeZone } = await this.metrics.getSettings(tenantId);
    const last = addCalendarDays(mondayOf(dateInZone(now, timeZone)), -7);
    const out: string[] = [];
    for (let m = last; m >= WEEKLY_FIGURES_FIRST_WEEK; m = addCalendarDays(m, -7)) out.push(m);
    return out;
  }

  // The PM's own projects (a member) that have tracking on.
  private async projectsFor(viewer: Viewer): Promise<Array<{ id: number; name: string }>> {
    return this.dataSource.query(
      `SELECT p.id, p.name FROM projects p JOIN user_projects up ON up."projectsId" = p.id AND up."usersId" = $1
        WHERE p."tenantId" = $2 AND p."performanceTrackingEnabled" = true ORDER BY p.name, p.id`,
      [viewer.id, viewer.tenantId],
    );
  }

  private async resolve(viewer: Viewer, week: string | undefined, projectId: number | undefined, now = new Date()) {
    this.assertPm(viewer);
    if (week !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new BadRequestException('week must be YYYY-MM-DD (a Monday).');
    const [weeks, projects] = await Promise.all([this.weeks(viewer.tenantId, now), this.projectsFor(viewer)]);
    const monday = week ?? weeks[0];
    if (!monday || !weeks.includes(monday)) {
      throw new BadRequestException(`Pick a completed week (a Monday) from ${ddmmyyyy(WEEKLY_FIGURES_FIRST_WEEK)} to last week.`);
    }
    const project = projectId === undefined ? projects[0] : projects.find((p) => p.id === projectId);
    if (projectId !== undefined && !project) throw new ForbiddenException('You can only see projects you are a member of that have Performance Tracking on.');
    return { monday, sunday: addCalendarDays(monday, 6), weeks, projects, project: project ?? null };
  }

  // Everything for one week + project: people, cells and the evidence.
  private async compute(viewer: Viewer, monday: string, sunday: string, projectId: number, now = new Date()) {
    const tenantId = viewer.tenantId;
    const week = await this.trackingMetrics.computeWeek(tenantId, projectId, sunday, now);
    const users = await this.usersService.findAll(tenantId);
    const byId = new Map(users.map((u) => [u.id, u]));
    const visible = (id: number) => {
      const u = byId.get(id);
      return !!u && !hiddenFromScorecard(u.email) && u.email !== process.env.SMOKE_TEST_EMAIL;
    };
    // The project's people: its members, plus anyone holding one of its
    // tasks. (C3 is person-level, so the nightly rows include every
    // developer in the company - not wanted on a per-project view.)
    const members = new Set<number>(
      (await this.dataSource.query(`SELECT "usersId" AS id FROM user_projects WHERE "projectsId" = $1`, [projectId])).map((r: any) => r.id as number),
    );
    const inProject = (id: number) => members.has(id) || !!week?.assignees.has(id);
    const rows = (week?.rows ?? []).filter((r) => visible(r.userId) && inProject(r.userId) && DEVELOPER_EQUIVALENT_ROLES.includes(byId.get(r.userId)!.role));
    const devIds = [...new Set(rows.map((r) => r.userId))];
    // QA: the project's QA members (C6 only).
    const qaIds = [...members].filter((id) => visible(id) && byId.get(id)!.role === UserRole.QA);

    // C6: only while switched on, and only for its projects.
    const c6Settings = await this.meetingAttendance.settings(tenantId);
    const c6On = c6Settings.meetingAttendanceEnabled && c6Settings.meetingAttendanceProjectIds.includes(projectId);
    const { timeZone } = await this.metrics.getSettings(tenantId);
    const from = startOfDayInZone(monday, timeZone);
    const to = startOfDayInZone(addCalendarDays(monday, 7), timeZone);
    const c6 = c6On ? await this.meetingAttendance.c6ByUser(tenantId, [...devIds, ...qaIds], from, to) : new Map();

    const c6Cell = (userId: number): WeeklyCell => {
      if (!c6On) return { metric: 'C6', value: null, numerator: null, denominator: null, sample: 0, state: 'off' };
      const s = c6.get(userId);
      if (!s || s.sample === 0) return { metric: 'C6', value: null, numerator: 0, denominator: 0, sample: 0, state: 'na' };
      return { metric: 'C6', value: s.value, numerator: s.numerator, denominator: s.denominator, sample: s.sample, state: s.sample >= c6Settings.meetingMinSample ? 'ok' : 'small' };
    };
    const cellOf = (r: TrackingMetricRow | undefined, metric: TrackingMetric): WeeklyCell => {
      if (!r) return { metric, value: null, numerator: null, denominator: null, sample: 0, state: 'na' };
      const cell: WeeklyCell = { metric, value: r.value, numerator: r.numerator, denominator: r.denominator, sample: r.sample, state: cellState(METRIC_INFO[metric].unit, r.value, r.sample, r.enoughData) };
      if (metric === 'C1') {
        cell.medianWorkingHours = (r.details as any).medianWorkingHours ?? null;
        cell.targetWorkingHours = (r.details as any).targetWorkingHours ?? null;
      }
      return cell;
    };
    const person = (userId: number, qa: boolean) => {
      const u = byId.get(userId)!;
      const mine = new Map(rows.filter((r) => r.userId === userId).map((r) => [r.metric, r]));
      const cells = METRICS.map((m): WeeklyCell =>
        m === 'C6' ? c6Cell(userId) : qa ? { metric: m, value: null, numerator: null, denominator: null, sample: 0, state: 'na' } : cellOf(mine.get(m), m),
      );
      return { userId, name: u.fullName || u.email, email: u.email, role: u.role, qa, cells, rows: mine };
    };
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const people = devIds.map((id) => person(id, false)).sort(byName);
    const qa = qaIds.filter((id) => !devIds.includes(id)).map((id) => person(id, true)).sort(byName);
    return { people, qa, c6On, c6MinSample: c6Settings.meetingMinSample, minSample: week?.minSample ?? null, taskTitles: week?.taskTitles ?? new Map<number, string>(), from, to };
  }

  private header(monday: string, sunday: string, project: { id: number; name: string } | null, weeks: string[], projects: Array<{ id: number; name: string }>) {
    return {
      week: { monday, sunday },
      project,
      choices: { weeks, projects },
      groups: WEEKLY_GROUPS,
      metricInfo: METRICS.map(infoOf),
      note: 'Raw values only - no 1-5 scores during the baseline (until 30-11-2026).',
    };
  }

  private audit(viewer: Viewer, action: string, projectId: number | null, details: Record<string, unknown>) {
    return this.auditLogService.record({
      userId: viewer.id,
      userEmail: viewer.email,
      userRole: viewer.role,
      action,
      tenantId: viewer.tenantId,
      entityType: 'Project',
      entityId: projectId ?? undefined,
      details,
    });
  }

  async table(viewer: Viewer, week?: string, projectId?: number, now = new Date()) {
    const { monday, sunday, weeks, projects, project } = await this.resolve(viewer, week, projectId, now);
    const base = this.header(monday, sunday, project, weeks, projects);
    if (!project) {
      await this.audit(viewer, WEEKLY_FIGURES_AUDIT.VIEWED, null, { week: monday, project: null, people: 0 });
      return { ...base, minSample: null, c6On: false, people: [], qa: [] };
    }
    const built = await this.compute(viewer, monday, sunday, project.id, now);
    const strip = ({ rows, ...p }: any) => p;
    await this.audit(viewer, WEEKLY_FIGURES_AUDIT.VIEWED, project.id, { week: monday, project: project.name, people: built.people.length, qa: built.qa.length });
    return { ...base, minSample: built.minSample, c6On: built.c6On, c6MinSample: built.c6MinSample, people: built.people.map(strip), qa: built.qa.map(strip) };
  }

  async person(viewer: Viewer, userId: number, week?: string, projectId?: number, now = new Date()) {
    const { monday, sunday, weeks, projects, project } = await this.resolve(viewer, week, projectId, now);
    if (!project) throw new NotFoundException(`User #${userId} has no figures here.`);
    const built = await this.compute(viewer, monday, sunday, project.id, now);
    const p = [...built.people, ...built.qa].find((x) => x.userId === userId);
    if (!p) throw new NotFoundException(`User #${userId} has no figures for this week and project.`);
    // C6 evidence: each stand-up of the week.
    const meetings = built.c6On
      ? (
          await this.dataSource.query(
            `SELECT o."startAt", a.outcome, a.excused, a."excuseReason" FROM meeting_attendance a JOIN meeting_occurrences o ON o.id = a."occurrenceId"
              WHERE a."tenantId" = $1 AND a."userId" = $2 AND o.status = 'imported' AND o."startAt" >= $3 AND o."startAt" < $4 ORDER BY o."startAt"`,
            [viewer.tenantId, userId, built.from, built.to],
          )
        ).map((m: any) => ({ startAt: new Date(m.startAt).toISOString(), outcome: m.outcome, excused: m.excused, excuseReason: m.excuseReason }))
      : [];
    const ids = new Set<number>();
    const collect = (v: unknown, key = '') => {
      if (Array.isArray(v)) v.forEach((x) => collect(x, key));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => collect(x, k));
      else if (typeof v === 'number' && /taskid/i.test(key)) ids.add(v);
    };
    const evidence = p.cells.map((c) => ({ ...c, details: c.metric === 'C6' ? { meetings } : p.rows.get(c.metric as TrackingMetric)?.details ?? null }));
    evidence.forEach((e) => collect(e.details));
    const taskTitles = Object.fromEntries([...ids].map((id) => [id, built.taskTitles.get(id) ?? null]));
    await this.audit(viewer, WEEKLY_FIGURES_AUDIT.PERSON_VIEWED, project.id, { week: monday, project: project.name, personUserId: userId });
    const { rows, cells, ...rest } = p;
    return { ...this.header(monday, sunday, project, weeks, projects), minSample: built.minSample, c6On: built.c6On, person: rest, metrics: evidence, taskTitles };
  }

  async exportExcel(viewer: Viewer, week?: string, projectId?: number, now = new Date()): Promise<{ buffer: Buffer; filename: string }> {
    const { monday, sunday, project } = await this.resolve(viewer, week, projectId, now);
    if (!project) throw new BadRequestException('You have no tracked project to export.');
    const built = await this.compute(viewer, monday, sunday, project.id, now);
    const text = (c: WeeklyCell) => formatCell(c, infoOf(c.metric).unit, c.metric === 'C6' ? built.c6MinSample : built.minSample ?? 5);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Tracker';
    const ws = wb.addWorksheet('Weekly figures');
    ws.columns = [
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Role', key: 'role', width: 12 },
      ...METRICS.map((m) => ({ header: m, key: m, width: m === 'C1' ? 30 : 22 })),
    ];
    for (const p of [...built.people, ...built.qa]) {
      ws.addRow({ name: p.name, role: p.qa ? 'QA (C6 only)' : p.role, ...Object.fromEntries(p.cells.map((c) => [c.metric, text(c)])) });
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    const ev = wb.addWorksheet('Evidence');
    ev.columns = [
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Metric', key: 'metric', width: 8 },
      { header: 'Measure', key: 'label', width: 34 },
      { header: 'Raw value', key: 'value', width: 30 },
      { header: 'Tasks counted', key: 'counted', width: 40 },
      { header: 'Other evidence', key: 'other', width: 80 },
    ];
    for (const p of built.people) {
      for (const c of p.cells) {
        if (c.metric === 'C6') continue;
        const d: any = p.rows.get(c.metric)?.details ?? {};
        const { countedTaskIds, ...other } = d;
        ev.addRow({ name: p.name, metric: c.metric, label: infoOf(c.metric).label, value: text(c), counted: (countedTaskIds ?? []).map((id: number) => `#${id}`).join(', '), other: Object.keys(other).length ? JSON.stringify(other) : '' });
      }
    }
    ev.getRow(1).font = { bold: true };
    const about = wb.addWorksheet('About');
    about.addRows([
      ['Project', project.name],
      ['Week', `${ddmmyyyy(monday)} to ${ddmmyyyy(sunday)} (Monday to Sunday)`],
      ['Values', 'RAW values, same definitions as the nightly metrics, over this 7-day window. No 1-5 scores during the baseline (until 30-11-2026).'],
      ['Minimum sample', `${built.minSample ?? 5} items (C6: ${built.c6MinSample} meetings); below it the value is marked "fewer than N items".`],
      ['C6', built.c6On ? 'Switched on for this project (shown only).' : 'Not switched on for this project.'],
      ['QA', 'QA people are listed with C6 only; the other metrics cover developer-type roles.'],
      ['Exported', `${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC by ${viewer.email}`],
      ['Note', 'Personal performance data - handle as confidential.'],
    ]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit(viewer, WEEKLY_FIGURES_AUDIT.EXPORTED, project.id, { week: monday, project: project.name, people: built.people.length, qa: built.qa.length, format: 'xlsx' });
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `project-${project.id}`;
    return { buffer, filename: `weekly-figures-${slug}-${ddmmyyyy(monday)}.xlsx` };
  }
}

// Text for one cell (export; the screen formats the same way).
export function formatCell(c: WeeklyCell, unit: string, minSample: number): string {
  if (c.state === 'off') return 'C6 not switched on';
  if (c.state === 'na') return 'n/a';
  const v = c.value as number;
  const ratio = c.denominator !== null && c.numerator !== null ? ` (${c.numerator}/${c.denominator})` : '';
  let s: string;
  if (c.metric === 'C1') s = `median ${c.medianWorkingHours ?? 'n/a'} working h · ${v}% within ${c.targetWorkingHours ?? 4} working h${ratio}`;
  else if (unit === 'percent') s = `${v}%${ratio}`;
  else if (unit === 'days') s = `${v} working days`;
  else if (c.metric === 'C2') s = `${v} working days`;
  else s = `${v}${ratio}`;
  return c.state === 'small' ? `${s} - fewer than ${minSample} items` : s;
}
