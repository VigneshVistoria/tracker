import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Project } from '../../projects/project.entity';
import { TenantsService } from '../../tenants/tenants.service';
import { UsersService } from '../../users/users.service';
import { DEVELOPER_EQUIVALENT_ROLES } from '../../users/user.entity';
import { PerformanceMetricsService } from '../../performance-metrics/performance-metrics.service';
import { addCalendarDays } from '../../performance-metrics/working-days';
import { dateInZone, startOfDayInZone } from '../../team-settings/time-zone';
import { PerformanceTrackingService } from '../performance-tracking.service';
import { projectTrackingPhase } from '../performance-tracking';
import { PerformanceMetricSnapshot } from './performance-metric-snapshot.entity';
import { PerformanceMetricRun } from './performance-metric-run.entity';
import { TRACKING_METRICS, computeTrackingMetrics } from './tracking-metrics';
import { WorkCalendarService } from '../../work-calendar/work-calendar.service';
import { workingDaysCalendar } from '../../work-calendar/work-calendar';

// Postgres advisory lock (key 1 = this job, key 2 = tenant): at most one
// run per tenant at a time, across processes too. Released when the
// connection closes, so a crashed run never blocks the next one.
const LOCK_KEY = 774411;
// A run row still 'running' this long after it started was interrupted.
const STALE_RUN_MS = 6 * 60 * 60 * 1000;

export interface RunResult {
  runId: number;
  status: 'done' | 'failed' | 'skipped';
  snapshotDate: string;
  projects: number;
  rowsWritten: number;
  error?: string;
}

// Performance Tracking B2 (2026-10-30) - the nightly metrics snapshot.
// Runs at 02:00 East Africa Time (outside working hours) for the day that
// just ended; Admins can also "Recalculate now" (today so far). Only
// projects with tracking ON get rows. Light on the server on purpose: one
// tenant and one project at a time, only that project's rows loaded, and
// a pause between projects so web requests keep being served. Safe to run
// twice for the same night: that night's rows for a project are replaced
// in one transaction (and a unique key backs it up).
@Injectable()
export class TrackingMetricsService {
  private readonly logger = new Logger(TrackingMetricsService.name);

  constructor(
    @InjectRepository(PerformanceMetricSnapshot) private snapshotsRepository: Repository<PerformanceMetricSnapshot>,
    @InjectRepository(PerformanceMetricRun) private runsRepository: Repository<PerformanceMetricRun>,
    private tracking: PerformanceTrackingService,
    private metrics: PerformanceMetricsService,
    private usersService: UsersService,
    private tenantsService: TenantsService,
    private workCalendars: WorkCalendarService,
    private dataSource: DataSource,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'Africa/Addis_Ababa' })
  async nightly() {
    const tenants = await this.tenantsService.findAll();
    for (const tenant of tenants) {
      try {
        const settings = await this.metrics.getSettings(tenant.id);
        // The day that just ended, in the team's zone.
        const yesterday = addCalendarDays(dateInZone(new Date(), settings.timeZone), -1);
        const result = await this.runTenant(tenant.id, { trigger: 'nightly', snapshotDate: yesterday });
        if (result.status !== 'done' || result.rowsWritten) {
          this.logger.log(`Performance metrics tenant #${tenant.id} ${result.snapshotDate}: ${result.status}, ${result.projects} projects, ${result.rowsWritten} rows`);
        }
      } catch (err: any) {
        this.logger.error(`Performance metrics failed for tenant #${tenant.id}: ${err.message}`);
      }
    }
  }

  async runTenant(
    tenantId: number,
    options: { trigger: 'nightly' | 'manual'; snapshotDate?: string; userId?: number; now?: Date },
  ): Promise<RunResult> {
    const now = options.now ?? new Date();
    const metricSettings = await this.metrics.getSettings(tenantId);
    const snapshotDate = options.snapshotDate ?? dateInZone(now, metricSettings.timeZone);
    await this.runsRepository.update(
      { tenantId, status: 'running', startedAt: LessThan(new Date(now.getTime() - STALE_RUN_MS)) },
      { status: 'failed', error: 'Interrupted (server restart?)', finishedAt: now },
    );

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let runId = 0;
    try {
      const [{ locked }] = await runner.query(`SELECT pg_try_advisory_lock($1, $2) AS locked`, [LOCK_KEY, tenantId]);
      if (!locked) {
        const skipped = await this.runsRepository.save(
          this.runsRepository.create({ tenantId, snapshotDate, trigger: options.trigger, triggeredByUserId: options.userId ?? null, status: 'skipped', error: 'Another run was still going.', finishedAt: new Date() }),
        );
        return { runId: skipped.id, status: 'skipped', snapshotDate, projects: 0, rowsWritten: 0, error: 'Another run was still going.' };
      }
      try {
        const run = await this.runsRepository.save(
          this.runsRepository.create({ tenantId, snapshotDate, trigger: options.trigger, triggeredByUserId: options.userId ?? null, status: 'running' }),
        );
        runId = run.id;
        const { projects, rows } = await this.computeAndStore(tenantId, snapshotDate, now, runId);
        await this.runsRepository.update({ id: runId }, { status: 'done', projects, rowsWritten: rows, finishedAt: new Date() });
        return { runId, status: 'done', snapshotDate, projects, rowsWritten: rows };
      } catch (err: any) {
        if (runId) await this.runsRepository.update({ id: runId }, { status: 'failed', error: String(err?.message ?? err).slice(0, 2000), finishedAt: new Date() });
        this.logger.error(`Performance metrics run #${runId} failed: ${err?.stack ?? err}`);
        return { runId, status: 'failed', snapshotDate, projects: 0, rowsWritten: 0, error: String(err?.message ?? err) };
      } finally {
        await runner.query(`SELECT pg_advisory_unlock($1, $2)`, [LOCK_KEY, tenantId]);
      }
    } finally {
      await runner.release();
    }
  }

  private async computeAndStore(tenantId: number, snapshotDate: string, now: Date, runId: number) {
    const thresholds = await this.tracking.thresholds(tenantId);
    const metricSettings = await this.metrics.getSettings(tenantId);
    const holidays = (await this.metrics.listHolidays(tenantId)).map((h) => h.date);
    const calendar = { timeZone: metricSettings.timeZone, weekendDays: metricSettings.weekendDays, holidays: new Set(holidays) };
    const smokeTestEmail = process.env.SMOKE_TEST_EMAIL;
    const people = (await this.usersService.findAll(tenantId))
      .filter((u) => DEVELOPER_EQUIVALENT_ROLES.includes(u.role) && u.email !== smokeTestEmail)
      .map((u) => u.id);
    const tracked = await this.dataSource.getRepository(Project).find({ where: { tenantId, performanceTrackingEnabled: true }, order: { id: 'ASC' } });
    // B4: everyone's own calendar (default EAT, 07:30-15:30, Sat/Sun off).
    const { byUser, fallback } = await this.workCalendars.calendarsFor(tenantId);
    const hoursFor = (userId: number) => byUser.get(userId) ?? fallback;
    const workingDaysFor = (userId: number) => {
      const person = hoursFor(userId);
      // Tenant-wide holidays are already in the person's days off.
      return workingDaysCalendar(person, calendar.timeZone);
    };

    // Rows for this night of projects no longer ON go too.
    await this.snapshotsRepository
      .createQueryBuilder()
      .delete()
      .where(`"tenantId" = :tenantId AND "snapshotDate" = :snapshotDate`, { tenantId, snapshotDate })
      .andWhere(tracked.length ? `"projectId" NOT IN (:...ids)` : 'TRUE', { ids: tracked.map((p) => p.id) })
      .execute();

    let rowsWritten = 0;
    let projects = 0;
    for (const project of tracked) {
      const since = project.performanceTrackingSince ? new Date(project.performanceTrackingSince) : null;
      // Nothing to measure before go-live.
      if (!since || dateInZone(since, calendar.timeZone) > snapshotDate) continue;
      const dayEnd = new Date(Math.min(now.getTime(), startOfDayInZone(addCalendarDays(snapshotDate, 1), calendar.timeZone).getTime() - 1));
      const { phase } = projectTrackingPhase(true, since, dayEnd, thresholds.baselineDays);
      const input = await this.load(tenantId, project.id, snapshotDate, now);
      const result = computeTrackingMetrics({
        snapshotDate,
        now,
        trackingSince: since,
        windowDays: metricSettings.windowDays,
        minSample: metricSettings.minSample,
        calendar,
        workingDaysFor,
        hoursFor,
        dueDateWorkingDays: metricSettings.dueDateWorkingDays,
        thresholds,
        people,
        ...input,
      });
      // Only people with something in this project.
      const active = new Set(result.rows.filter((r) => r.sample > 0 || (r.value !== null && r.value !== 0)).map((r) => r.userId));
      for (const id of input.assignees) active.add(id);
      const rows = result.rows.filter((r) => active.has(r.userId));
      await this.dataSource.transaction(async (em) => {
        await em.delete(PerformanceMetricSnapshot, { tenantId, snapshotDate, projectId: project.id });
        for (let i = 0; i < rows.length; i += 200) {
          await em.insert(
            PerformanceMetricSnapshot,
            rows.slice(i, i + 200).map((r) => ({
              tenantId,
              snapshotDate,
              projectId: project.id,
              userId: r.userId,
              metric: r.metric,
              phase: phase === 'scoring' ? 'scoring' : 'baseline',
              value: r.value === null ? null : String(r.value),
              numerator: r.numerator,
              denominator: r.denominator,
              sample: r.sample,
              enoughData: r.enoughData,
              windowFrom: result.windowFrom,
              details: r.details,
              runId,
            })),
          );
        }
      });
      rowsWritten += rows.length;
      projects += 1;
      // Let waiting web requests through before the next project.
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { projects, rows: rowsWritten };
  }

  // One project's raw data - only the columns the metrics read.
  private async load(tenantId: number, projectId: number, snapshotDate: string, now: Date) {
    const q = (sql: string, params: any[]) => this.dataSource.query(sql, params);
    const tasks: any[] = await q(
      `SELECT id, status, "assigneeUserId", "createdByUserId", "dueDate"::text AS "dueDate", "isDefect", "taskType", "requirementId", "clientImpact",
              "improvementDecision", "improvementDecidedAt",
              "createdAt", "foundInProduction", "escapedFromTaskId", "productionReleaseDate"::text AS "productionReleaseDate"
         FROM project_tasks WHERE "tenantId" = $1 AND "projectId" = $2`,
      [tenantId, projectId],
    );
    const ids = tasks.map((t) => t.id);
    const empty = { rounds: [], commitmentEvents: [], flags: [], tickets: [], reopens: [], chases: [], notes: [], statusEvents: [], requests: [], releaseLog: [], techReviews: [] };
    const report = await this.metrics.computeReport(tenantId, { projectId, to: snapshotDate, now });
    const onTimeItems = new Map(report.people.map((p) => [p.userId, p.onTime.items]));
    const chargedChanges = new Map(report.people.map((p) => [p.userId, p.dueChanges.items]));
    const changeSample = new Map(report.people.map((p) => [p.userId, p.dueChanges.tasksCounted.length]));
    const assignees = new Set<number>(tasks.filter((t) => t.assigneeUserId != null && t.status !== 'Junk').map((t) => t.assigneeUserId));
    const base = {
      tasks: tasks.map((t) => ({ ...t, improvementDecidedAt: t.improvementDecidedAt ? new Date(t.improvementDecidedAt) : null, createdAt: t.createdAt ? new Date(t.createdAt) : null })),
      onTimeItems,
      chargedChanges,
      changeSample,
      assignees,
    };
    // Q5 reviews belong to the project, not to a task.
    const techReviews = (
      await q(`SELECT id, "revieweeUserId", "reviewedAt", average FROM tech_reviews WHERE "tenantId" = $1 AND "projectId" = $2`, [tenantId, projectId])
    ).map((r: any) => ({ id: r.id, revieweeUserId: r.revieweeUserId, reviewedAt: new Date(r.reviewedAt), average: Number(r.average) }));
    if (ids.length === 0) return { ...base, ...empty, techReviews };
    const [rounds, commitmentEvents, flags, tickets, reopens, chases, notes, statusEvents, requests, releaseLog] = await Promise.all([
      q(`SELECT "taskId", "submittedByUserId", "submittedAt", status, "reviewType", "reviewedAt", "dependencyExempt" FROM task_qa_reviews WHERE "tenantId" = $1 AND "taskId" = ANY($2) ORDER BY "submittedAt", id`, [tenantId, ids]),
      q(`SELECT "taskId", kind, "assigneeUserId", "occurredAt", "newDueDate"::text AS "newDueDate" FROM task_commitment_events WHERE "tenantId" = $1 AND "taskId" = ANY($2) ORDER BY "occurredAt", id`, [tenantId, ids]),
      q(
        `SELECT "taskId", kind, "setByAssignee", "assigneeUserId", "committedDueDateAtSet"::text AS "committedDueDateAtSet", "blockingOwnerUserId", external, "dependencyTicketId", "setAt", "clearedAt"
           FROM task_flags WHERE "tenantId" = $1 AND "taskId" = ANY($2) ORDER BY "setAt", id`,
        [tenantId, ids],
      ),
      q(`SELECT id, "parentTaskId", "ownerUserId", "createdByUserId", "createdAt", "overdueAt", status, "resolvedAt" FROM task_dependency_tickets WHERE "tenantId" = $1 AND "parentTaskId" = ANY($2)`, [tenantId, ids]),
      q(`SELECT "taskId", "reopenedAt", "passedAt", "chargedUserId" FROM task_reopens WHERE "tenantId" = $1 AND "taskId" = ANY($2)`, [tenantId, ids]),
      q(`SELECT "taskId", "assigneeUserId", "createdAt" FROM task_chases WHERE "tenantId" = $1 AND "taskId" = ANY($2)`, [tenantId, ids]),
      q(`SELECT "taskId", "authorUserId", "createdAt" FROM task_progress_notes WHERE "tenantId" = $1 AND "taskId" = ANY($2)`, [tenantId, ids]),
      q(`SELECT "taskId", "toStatus", "occurredAt", "actorUserId" FROM task_status_events WHERE "tenantId" = $1 AND "taskId" = ANY($2) ORDER BY "occurredAt", id`, [tenantId, ids]),
      q(`SELECT source, "dependencyTicketId", "requestedOfUserId", "requestedAt", "respondedAt" FROM task_requests WHERE "tenantId" = $1 AND "taskId" = ANY($2)`, [tenantId, ids]),
      q(
        `SELECT i."taskId", r."releaseDate"::text AS "releaseDate" FROM release_items i JOIN releases r ON r.id = i."releaseId"
          WHERE i."tenantId" = $1 AND i."taskId" = ANY($2)`,
        [tenantId, ids],
      ),
    ]);
    const dates = <T>(rows: any[], keys: string[]): T[] =>
      rows.map((r) => {
        for (const k of keys) if (r[k] != null) r[k] = new Date(r[k]);
        return r;
      });
    return {
      ...base,
      rounds: dates(rounds, ['submittedAt', 'reviewedAt']),
      commitmentEvents: dates(commitmentEvents, ['occurredAt']),
      flags: dates(flags, ['setAt', 'clearedAt']),
      tickets: dates(tickets, ['createdAt', 'overdueAt', 'resolvedAt']),
      reopens: dates(reopens, ['reopenedAt', 'passedAt']),
      chases: dates(chases, ['createdAt']),
      notes: dates(notes, ['createdAt']),
      statusEvents: dates(statusEvents, ['occurredAt']),
      requests: dates(requests, ['requestedAt', 'respondedAt']),
      releaseLog: releaseLog as Array<{ taskId: number; releaseDate: string }>,
      techReviews,
    };
  }

  // For the settings screen: the latest runs.
  recentRuns(tenantId: number) {
    return this.runsRepository.find({ where: { tenantId }, order: { startedAt: 'DESC', id: 'DESC' }, take: 10 });
  }

  // Raw rows for one night (scorecard comes in B3).
  async snapshot(tenantId: number, snapshotDate: string | undefined, projectId: number | undefined) {
    const date =
      snapshotDate ??
      (
        await this.snapshotsRepository.createQueryBuilder('s').select('MAX(s."snapshotDate")::text', 'd').where('s."tenantId" = :tenantId', { tenantId }).getRawOne()
      )?.d ??
      null;
    if (!date) return { snapshotDate: null, metrics: TRACKING_METRICS, rows: [] };
    const rows = await this.snapshotsRepository.find({
      where: { tenantId, snapshotDate: date, ...(projectId ? { projectId } : {}) },
      order: { projectId: 'ASC', userId: 'ASC', metric: 'ASC' },
    });
    return { snapshotDate: date, metrics: TRACKING_METRICS, rows };
  }
}
