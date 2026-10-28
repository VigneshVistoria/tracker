import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { UsersService } from '../users/users.service';
import { DEVELOPER_EQUIVALENT_ROLES, UserRole } from '../users/user.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { isValidTimeZone, dateInZone } from '../team-settings/time-zone';
import { TaskCommitmentEvent } from './task-commitment-event.entity';
import { PerformanceMetricSettings } from './performance-metric-settings.entity';
import { PerformanceHoliday } from './performance-holiday.entity';
import { UpdatePerformanceSettingsDto } from './dto/update-performance-settings.dto';
import { CreatePerformanceHolidayDto } from './dto/create-performance-holiday.dto';
import {
  MetricsResult,
  PERFORMANCE_SETTINGS_DEFAULTS,
  PerformanceSettings,
  computePerformanceMetrics,
} from './performance-metrics.compute';

export interface PerformanceSettingsView extends PerformanceSettings {
  isDefault: boolean;
  updatedAt: Date | null;
  updatedByName: string | null;
}

export interface PerformanceMetricsReport extends MetricsResult {
  projectId: number | null;
  settings: PerformanceSettings;
  // Earliest recorded assignment / Due date event (live or reconstructed),
  // when live recording began (null until the first live event), and the
  // earliest QA submission - the "history starts on" label.
  history: { startsOn: string | null; liveSince: string | null; qaStartsOn: string | null };
  // userId -> display name, for "changed by" / "set by" in the drill-down.
  names: Record<number, string>;
}

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');

// Settings, holidays and the report. Read-only on tickets.
@Injectable()
export class PerformanceMetricsService {
  constructor(
    @InjectRepository(PerformanceMetricSettings) private readonly settingsRepository: Repository<PerformanceMetricSettings>,
    @InjectRepository(PerformanceHoliday) private readonly holidaysRepository: Repository<PerformanceHoliday>,
    @InjectRepository(TaskCommitmentEvent) private readonly eventsRepository: Repository<TaskCommitmentEvent>,
    @InjectRepository(ProjectTask) private readonly tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TaskQaReview) private readonly qaReviewsRepository: Repository<TaskQaReview>,
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------- Settings ----------

  // Never writes - a tenant without a row gets the defaults.
  async getSettings(tenantId: number): Promise<PerformanceSettingsView> {
    const row = await this.settingsRepository.findOne({ where: { tenantId } });
    if (!row) return { ...PERFORMANCE_SETTINGS_DEFAULTS, isDefault: true, updatedAt: null, updatedByName: null };
    const editor = row.updatedByUserId ? await this.usersService.findByIdAndTenant(row.updatedByUserId, tenantId) : null;
    return {
      timeZone: isValidTimeZone(row.timeZone) ? row.timeZone : PERFORMANCE_SETTINGS_DEFAULTS.timeZone,
      dueDateWorkingDays: row.dueDateWorkingDays,
      weekendDays: splitList(row.weekendDays).map(Number),
      windowDays: row.windowDays,
      minSample: row.minSample,
      onTimeOkPercent: Number(row.onTimeOkPercent),
      changesOkPerTask: Number(row.changesOkPerTask),
      qaAcceptanceOkPercent: Number(row.qaAcceptanceOkPercent),
      excludedStatuses: splitList(row.excludedStatuses),
      includePeerReview: row.includePeerReview,
      countEscalatedAsDecided: row.countEscalatedAsDecided,
      alreadyDatedCountsOnTime: row.alreadyDatedCountsOnTime,
      othersSettingDateCountsOnTime: row.othersSettingDateCountsOnTime,
      lateToQaFlagCount: row.lateToQaFlagCount,
      rejectionRateFlagPercent: Number(row.rejectionRateFlagPercent),
      rejectionRateMinSubmissions: row.rejectionRateMinSubmissions,
      escalationFlagCount: row.escalationFlagCount,
      vagueNotesFlagCount: row.vagueNotesFlagCount,
      isDefault: false,
      updatedAt: row.updatedAt,
      updatedByName: editor ? editor.fullName || editor.email : null,
    };
  }

  // The settings row and its audit entry are saved in one transaction, so
  // a change can never land without its audit row.
  async updateSettings(
    dto: UpdatePerformanceSettingsDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<PerformanceSettingsView> {
    const view = await this.getSettings(tenantId);
    const { isDefault, updatedAt, updatedByName, ...before } = view;
    const after: PerformanceSettings = { ...before };
    for (const key of Object.keys(dto) as Array<keyof UpdatePerformanceSettingsDto>) {
      if (dto[key] !== undefined) (after as any)[key] = dto[key];
    }
    after.timeZone = after.timeZone.trim();
    after.weekendDays = [...new Set(after.weekendDays)].sort();
    after.excludedStatuses = [...new Set(after.excludedStatuses.map((s) => s.trim()).filter((s) => s !== ''))];
    if (!isValidTimeZone(after.timeZone)) {
      throw new BadRequestException(`"${after.timeZone}" is not a recognised time zone (example: Africa/Addis_Ababa).`);
    }
    if (after.weekendDays.length >= 7) throw new BadRequestException('At least one day of the week must be a working day.');

    await this.settingsRepository.manager.transaction(async (em) => {
      const repo = em.getRepository(PerformanceMetricSettings);
      await repo.save(
        repo.create({
          tenantId,
          timeZone: after.timeZone,
          dueDateWorkingDays: after.dueDateWorkingDays,
          weekendDays: after.weekendDays.join(','),
          windowDays: after.windowDays,
          minSample: after.minSample,
          onTimeOkPercent: String(after.onTimeOkPercent),
          changesOkPerTask: String(after.changesOkPerTask),
          qaAcceptanceOkPercent: String(after.qaAcceptanceOkPercent),
          excludedStatuses: after.excludedStatuses.join(','),
          includePeerReview: after.includePeerReview,
          countEscalatedAsDecided: after.countEscalatedAsDecided,
          alreadyDatedCountsOnTime: after.alreadyDatedCountsOnTime,
          othersSettingDateCountsOnTime: after.othersSettingDateCountsOnTime,
          lateToQaFlagCount: after.lateToQaFlagCount,
          rejectionRateFlagPercent: String(after.rejectionRateFlagPercent),
          rejectionRateMinSubmissions: after.rejectionRateMinSubmissions,
          escalationFlagCount: after.escalationFlagCount,
          vagueNotesFlagCount: after.vagueNotesFlagCount,
          updatedByUserId: currentUser.id,
        }),
      );
      await this.auditLogService.recordWithin(em, {
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        action: AuditActions.PERFORMANCE_METRIC_SETTINGS_UPDATED,
        tenantId,
        entityType: 'PerformanceMetricSettings',
        entityId: tenantId,
        details: { before, after },
      });
    });
    return this.getSettings(tenantId);
  }

  // ---------- Holidays ----------

  listHolidays(tenantId: number): Promise<PerformanceHoliday[]> {
    return this.holidaysRepository.find({ where: { tenantId }, order: { date: 'ASC' } });
  }

  async addHoliday(dto: CreatePerformanceHolidayDto, currentUser: { id: number; email: string; role: UserRole }, tenantId: number) {
    if (Number.isNaN(new Date(`${dto.date}T00:00:00Z`).getTime()) || new Date(`${dto.date}T00:00:00Z`).toISOString().slice(0, 10) !== dto.date) {
      throw new BadRequestException(`${dto.date} is not a real date.`);
    }
    if (await this.holidaysRepository.findOne({ where: { tenantId, date: dto.date } })) {
      throw new ConflictException(`${dto.date} is already a holiday.`);
    }
    return this.holidaysRepository.manager.transaction(async (em) => {
      const repo = em.getRepository(PerformanceHoliday);
      const saved = await repo.save(repo.create({ tenantId, date: dto.date, name: dto.name.trim(), createdByUserId: currentUser.id }));
      await this.auditLogService.recordWithin(em, {
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        action: AuditActions.PERFORMANCE_HOLIDAY_ADDED,
        tenantId,
        entityType: 'PerformanceHoliday',
        entityId: saved.id,
        details: { date: saved.date, name: saved.name },
      });
      return saved;
    });
  }

  async removeHoliday(id: number, currentUser: { id: number; email: string; role: UserRole }, tenantId: number): Promise<void> {
    const holiday = await this.holidaysRepository.findOne({ where: { id, tenantId } });
    if (!holiday) throw new NotFoundException(`Holiday #${id} not found`);
    await this.holidaysRepository.manager.transaction(async (em) => {
      await em.getRepository(PerformanceHoliday).delete({ id, tenantId });
      await this.auditLogService.recordWithin(em, {
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        action: AuditActions.PERFORMANCE_HOLIDAY_REMOVED,
        tenantId,
        entityType: 'PerformanceHoliday',
        entityId: id,
        details: { date: holiday.date, name: holiday.name },
      });
    });
  }

  // ---------- Report ----------

  // Who started each Due date change (2026-10-28): an approved Performance
  // Tracking request was started by its requester, though the approver's
  // edit applied it. (The assignee's own commitments are 'due_committed'
  // events and never count as changes.)
  private async dueChangeStarters(tenantId: number, auditLogIds: number[]): Promise<Map<number, number>> {
    const requestedBy = new Map<number, number>();
    if (auditLogIds.length === 0) return requestedBy;
    const requests: Array<{ auditLogId: number; requestedByUserId: number }> = await this.eventsRepository.query(
      `SELECT "auditLogId", "requestedByUserId" FROM "due_date_change_requests"
        WHERE "tenantId" = $1 AND "kind" = 'request' AND "status" = 'approved' AND "auditLogId" = ANY($2)`,
      [tenantId, auditLogIds],
    );
    for (const r of requests) requestedBy.set(r.auditLogId, r.requestedByUserId);
    return requestedBy;
  }

  // onlyUserId set = a developer looking at their own figures.
  async computeReport(
    tenantId: number,
    options: { projectId?: number; to?: string; onlyUserId?: number; now?: Date },
  ): Promise<PerformanceMetricsReport> {
    const now = options.now ?? new Date();
    const view = await this.getSettings(tenantId);
    const { isDefault, updatedAt, updatedByName, ...settings } = view;
    const holidays = (await this.listHolidays(tenantId)).map((h) => h.date);

    // Same population as the rest of the Non-Compliance Report, smoke
    // test account excluded the same way.
    const smokeTestEmail = process.env.SMOKE_TEST_EMAIL;
    const allUsers = await this.usersService.findAll(tenantId);
    const names: Record<number, string> = {};
    for (const u of allUsers) names[u.id] = u.fullName || u.email;
    const people = allUsers
      .filter((u) => DEVELOPER_EQUIVALENT_ROLES.includes(u.role) && u.email !== smokeTestEmail)
      .filter((u) => options.onlyUserId === undefined || u.id === options.onlyUserId)
      .map((u) => ({ id: u.id, fullName: u.fullName ?? null, email: u.email, role: u.role }));

    const tasks = await this.tasksRepository.find({
      where: {
        tenantId,
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(settings.excludedStatuses.length ? { status: Not(In(settings.excludedStatuses)) } : {}),
      },
    });
    const taskIds = tasks.map((x) => x.id);
    const events = taskIds.length ? await this.eventsRepository.find({ where: { tenantId, taskId: In(taskIds) } }) : [];
    const rounds = taskIds.length ? await this.qaReviewsRepository.find({ where: { tenantId, taskId: In(taskIds) } }) : [];
    // Projects with Performance Tracking ON, and since when.
    const trackedRows: Array<{ id: number; since: Date | null }> = await this.eventsRepository.query(
      `SELECT id, "performanceTrackingSince" AS since FROM "projects" WHERE "tenantId" = $1 AND "performanceTrackingEnabled"`,
      [tenantId],
    );
    const trackingSince = new Map(trackedRows.filter((r) => r.since).map((r) => [r.id, new Date(r.since!)]));
    const starters = await this.dueChangeStarters(tenantId, events.filter((e) => e.kind === 'due_changed').map((e) => e.auditLogId));

    const result = computePerformanceMetrics({
      now,
      to: options.to,
      settings,
      holidays,
      people,
      tasks: tasks.map((x) => ({
        id: x.id,
        title: x.title,
        status: x.status,
        createdAt: x.createdAt,
        assigneeUserId: x.assigneeUserId ?? null,
        dueDate: x.dueDate ?? null,
        completedAt: x.completedAt ?? null,
        trackingSince: trackingSince.get(x.projectId) ?? null,
      })),
      events: events.map((e) => ({
        taskId: e.taskId,
        kind: e.kind,
        assigneeUserId: e.assigneeUserId,
        actorUserId: e.actorUserId,
        occurredAt: e.occurredAt,
        newDueDate: e.newDueDate,
        source: e.source,
        auditLogId: e.auditLogId,
        ...(e.kind === 'due_changed' ? { initiatorUserId: starters.get(e.auditLogId) ?? e.actorUserId } : {}),
      })),
      rounds: rounds.map((r) => ({
        taskId: r.taskId,
        roundNumber: r.roundNumber,
        submittedByUserId: r.submittedByUserId,
        submittedAt: r.submittedAt,
        status: r.status,
        reviewType: r.reviewType,
        reviewedAt: r.reviewedAt ?? null,
        revertedDecision: r.revertedDecision ?? null,
      })),
    });

    const [range] = await this.eventsRepository.query(
      `SELECT min("occurredAt") AS "startsAt", min("occurredAt") FILTER (WHERE "source" = 'live') AS "liveAt" FROM "task_commitment_events" WHERE "tenantId" = $1`,
      [tenantId],
    );
    const [qaRange] = await this.qaReviewsRepository.query(`SELECT min("submittedAt") AS "startsAt" FROM "task_qa_reviews" WHERE "tenantId" = $1`, [tenantId]);
    const day = (v: Date | string | null) => (v ? dateInZone(new Date(v), settings.timeZone) : null);

    return {
      ...result,
      projectId: options.projectId ?? null,
      settings,
      history: { startsOn: day(range?.startsAt ?? null), liveSince: day(range?.liveAt ?? null), qaStartsOn: day(qaRange?.startsAt ?? null) },
      names,
    };
  }
}
