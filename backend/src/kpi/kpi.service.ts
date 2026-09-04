import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { KpiConfig } from './kpi-config.entity';
import { KpiPeriodScore, KpiPeriodType } from './kpi-period-score.entity';
import { UpdateKpiConfigDto } from './dto/update-kpi-config.dto';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

// Only status a task can be scored as "done" against - see the gap
// analysis: the two Released statuses are deliberately, permanently dead
// (task-status-percent.entity.ts), so Pass is the real terminal state.
const COMPLETED_STATUS = 'Pass';

interface PeriodRange {
  start: Date;
  end: Date;
}

interface PeriodMetrics {
  ticketsDue: number;
  ticketsCompleted: number;
  completionPercent: number;
  hoursExceedPercent: number;
  overduePercent: number;
  targetMissPercent: number;
  qaRejectionCount: number;
  excessiveRejectionFlag: boolean;
  outboundDependencyOverduePercent: number;
  inboundDependencyOverdueCount: number;
  compositeScore: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class KpiService {
  constructor(
    @InjectRepository(KpiConfig)
    private configRepository: Repository<KpiConfig>,
    @InjectRepository(KpiPeriodScore)
    private scoreRepository: Repository<KpiPeriodScore>,
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    @InjectRepository(TaskDependencyTicket)
    private depTicketsRepository: Repository<TaskDependencyTicket>,
    private auditLogService: AuditLogService,
  ) {}

  // ---------------------------------------------------------------
  // Config (singleton per tenant, same pattern as PerformanceScoringConfig)
  // ---------------------------------------------------------------

  private async getOrCreateConfigRow(tenantId: number): Promise<KpiConfig> {
    const existing = await this.configRepository.find({ where: { tenantId }, take: 1 });
    if (existing.length > 0) return existing[0];
    return this.configRepository.save(this.configRepository.create({ tenantId }));
  }

  getConfig(tenantId: number): Promise<KpiConfig> {
    return this.getOrCreateConfigRow(tenantId);
  }

  async updateConfig(dto: UpdateKpiConfigDto, user: { id: number; email: string }, tenantId: number): Promise<KpiConfig> {
    const existing = await this.getOrCreateConfigRow(tenantId);
    const previous = { ...existing };

    if (dto.hoursExceedWeight !== undefined) existing.hoursExceedWeight = dto.hoursExceedWeight;
    if (dto.overdueWeight !== undefined) existing.overdueWeight = dto.overdueWeight;
    if (dto.targetMissWeight !== undefined) existing.targetMissWeight = dto.targetMissWeight;
    if (dto.qaRejectionWeight !== undefined) existing.qaRejectionWeight = dto.qaRejectionWeight;
    if (dto.outboundDependencyWeight !== undefined) existing.outboundDependencyWeight = dto.outboundDependencyWeight;
    if (dto.completionBonusWeight !== undefined) existing.completionBonusWeight = dto.completionBonusWeight;
    if (dto.completionBonusCap !== undefined) existing.completionBonusCap = dto.completionBonusCap;
    if (dto.excessiveRejectionThreshold !== undefined) existing.excessiveRejectionThreshold = dto.excessiveRejectionThreshold;
    existing.updatedByUserId = user.id;
    existing.updatedByEmail = user.email;

    const saved = await this.configRepository.save(existing);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.KPI_CONFIG_UPDATED,
      tenantId,
      entityType: 'KpiConfig',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  // ---------------------------------------------------------------
  // Period range resolution - weekly matches WeeklyReportsService's own
  // Monday-Friday business week convention exactly.
  // ---------------------------------------------------------------

  private toDateOnly(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private resolveRange(periodType: KpiPeriodType, referenceDate: Date): PeriodRange {
    const d = new Date(referenceDate);
    d.setHours(0, 0, 0, 0);

    if (periodType === 'daily') {
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      return { start: d, end };
    }

    if (periodType === 'weekly') {
      const day = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const start = new Date(d);
      start.setDate(d.getDate() + diffToMonday);
      const end = new Date(start);
      end.setDate(start.getDate() + 4); // Friday
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    // monthly - calendar month
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  // ---------------------------------------------------------------
  // Per (project, assignee, period) metric computation.
  //
  // Interpretation notes (flagged in the plan - confirm against the real
  // spec sheet once available):
  // - Overdue % = tasks due in this period, still open right now, past
  //   due date - an in-flight snapshot, not period-locked.
  // - Target Miss % = of tasks due AND completed in this period, what %
  //   were completed after their due date.
  // - Dependency-blocked override: a task is excluded from both Overdue %
  //   and Target Miss % if the assignee has an open Inbound dependency
  //   ticket (they filed it - blocked on someone else) against that task.
  // - Outbound/Inbound dependency direction is scoped to this project via
  //   the ticket's parent task's projectId (TaskDependencyTicket has no
  //   project field of its own).
  // - "Excessive QA Rejection Flag" is treated as a 100%/0% penalty term
  //   (flag true = full weight applied) so its units match every other
  //   percent-based term in the formula.
  // ---------------------------------------------------------------

  private async computeMetrics(
    tenantId: number,
    projectId: number,
    assigneeUserId: number,
    range: PeriodRange,
    config: KpiConfig,
  ): Promise<PeriodMetrics> {
    const startStr = this.toDateOnly(range.start);
    const endStr = this.toDateOnly(range.end);
    const todayStr = this.toDateOnly(new Date());

    const dueTasks = await this.tasksRepository.find({
      where: { tenantId, projectId, assigneeUserId, dueDate: Between(startStr, endStr) },
    });
    const ticketsDue = dueTasks.length;

    const completedTasks = dueTasks.filter((t) => t.status === COMPLETED_STATUS);
    const ticketsCompleted = completedTasks.length;
    const completionPercent = ticketsDue > 0 ? (ticketsCompleted / ticketsDue) * 100 : 0;

    // Inbound tickets this assignee filed (blocked on someone else) -
    // used only for the "not their fault" overdue override.
    const inboundOpenTickets = await this.depTicketsRepository.find({
      where: { tenantId, createdByUserId: assigneeUserId, status: 'open' },
    });
    const blockedTaskIds = new Set(inboundOpenTickets.map((t) => t.parentTaskId));

    const openTasks = dueTasks.filter((t) => t.status !== COMPLETED_STATUS);
    const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < todayStr && !blockedTaskIds.has(t.id));
    const overduePercent = ticketsDue > 0 ? (overdueTasks.length / ticketsDue) * 100 : 0;

    const lateCompletedTasks = completedTasks.filter(
      (t) => t.completedAt && t.dueDate && this.toDateOnly(new Date(t.completedAt)) > t.dueDate && !blockedTaskIds.has(t.id),
    );
    const targetMissPercent = ticketsCompleted > 0 ? (lateCompletedTasks.length / ticketsCompleted) * 100 : 0;

    const hoursComparable = completedTasks.filter((t) => t.estimatedHours != null && t.actualHours != null);
    const hoursExceeded = hoursComparable.filter((t) => Number(t.actualHours) > Number(t.estimatedHours));
    const hoursExceedPercent = hoursComparable.length > 0 ? (hoursExceeded.length / hoursComparable.length) * 100 : 0;

    // QA rejection count - across every task this assignee has in this
    // project (not just ones due this period), rejected within the period.
    const allAssigneeTasks = await this.tasksRepository.find({
      where: { tenantId, projectId, assigneeUserId },
      select: ['id'],
    });
    const allTaskIds = allAssigneeTasks.map((t) => t.id);
    const qaRejections =
      allTaskIds.length > 0
        ? await this.qaReviewsRepository.find({
            where: { tenantId, taskId: In(allTaskIds), status: 'rejected', reviewedAt: Between(range.start, range.end) },
          })
        : [];
    const qaRejectionCount = qaRejections.length;
    const excessiveRejectionFlag = qaRejectionCount > config.excessiveRejectionThreshold;

    // Outbound (this assignee owns clearing it) - scoped to this project
    // via the parent task's projectId.
    const outboundAll = await this.depTicketsRepository.find({ where: { tenantId, ownerUserId: assigneeUserId } });
    const outboundParents = await this.loadParentTasks(outboundAll, tenantId);
    const outboundInProject = outboundAll.filter((t) => outboundParents.get(t.parentTaskId)?.projectId === projectId);
    const outboundOpen = outboundInProject.filter((t) => t.status === 'open');
    const outboundOverdue = outboundOpen.filter((t) => {
      const parent = outboundParents.get(t.parentTaskId);
      return !!parent?.dueDate && parent.dueDate < todayStr;
    });
    const outboundDependencyOverduePercent = outboundOpen.length > 0 ? (outboundOverdue.length / outboundOpen.length) * 100 : 0;

    // Inbound (this assignee filed it, blocked on someone else) -
    // informational only, never penalized.
    const inboundAll = await this.depTicketsRepository.find({ where: { tenantId, createdByUserId: assigneeUserId } });
    const inboundParents = await this.loadParentTasks(inboundAll, tenantId);
    const inboundInProject = inboundAll.filter((t) => inboundParents.get(t.parentTaskId)?.projectId === projectId);
    const inboundDependencyOverdueCount = inboundInProject.filter((t) => {
      if (t.status !== 'open') return false;
      const parent = inboundParents.get(t.parentTaskId);
      return !!parent?.dueDate && parent.dueDate < todayStr;
    }).length;

    const excessiveRejectionPenaltyPercent = excessiveRejectionFlag ? 100 : 0;
    const bonus = Math.min(completionPercent * Number(config.completionBonusWeight), Number(config.completionBonusCap));
    const raw =
      100 -
      hoursExceedPercent * Number(config.hoursExceedWeight) -
      overduePercent * Number(config.overdueWeight) -
      targetMissPercent * Number(config.targetMissWeight) -
      excessiveRejectionPenaltyPercent * Number(config.qaRejectionWeight) -
      outboundDependencyOverduePercent * Number(config.outboundDependencyWeight) +
      bonus;
    const compositeScore = Math.max(0, Math.min(100, round2(raw)));

    return {
      ticketsDue,
      ticketsCompleted,
      completionPercent: round2(completionPercent),
      hoursExceedPercent: round2(hoursExceedPercent),
      overduePercent: round2(overduePercent),
      targetMissPercent: round2(targetMissPercent),
      qaRejectionCount,
      excessiveRejectionFlag,
      outboundDependencyOverduePercent: round2(outboundDependencyOverduePercent),
      inboundDependencyOverdueCount,
      compositeScore,
    };
  }

  private async loadParentTasks(tickets: TaskDependencyTicket[], tenantId: number): Promise<Map<number, ProjectTask>> {
    const parentIds = [...new Set(tickets.map((t) => t.parentTaskId))];
    if (parentIds.length === 0) return new Map();
    const parents = await this.tasksRepository.find({ where: { id: In(parentIds), tenantId } });
    return new Map(parents.map((t) => [t.id, t]));
  }

  // ---------------------------------------------------------------
  // Generation - always inserts new, frozen rows (never updates a
  // previously-generated one), same immutability guarantee as
  // WeeklyReportsService.generate().
  // ---------------------------------------------------------------

  async generatePeriod(
    periodType: KpiPeriodType,
    referenceDate: Date,
    tenantId: number,
    generatedByUserId?: number,
  ): Promise<KpiPeriodScore[]> {
    const range = this.resolveRange(periodType, referenceDate);
    const config = await this.getOrCreateConfigRow(tenantId);
    const startStr = this.toDateOnly(range.start);
    const endStr = this.toDateOnly(range.end);

    const dueTasks = await this.tasksRepository.find({
      where: { tenantId, dueDate: Between(startStr, endStr), assigneeUserId: Not(IsNull()) },
    });

    const pairs = new Map<string, { projectId: number; projectName: string; assigneeUserId: number; assigneeEmail: string }>();
    for (const t of dueTasks) {
      const key = `${t.projectId}:${t.assigneeUserId}`;
      if (!pairs.has(key)) {
        pairs.set(key, {
          projectId: t.projectId,
          projectName: t.projectName,
          assigneeUserId: t.assigneeUserId,
          assigneeEmail: t.assigneeEmail,
        });
      }
    }

    const weightsSnapshot = JSON.stringify({
      hoursExceedWeight: config.hoursExceedWeight,
      overdueWeight: config.overdueWeight,
      targetMissWeight: config.targetMissWeight,
      qaRejectionWeight: config.qaRejectionWeight,
      outboundDependencyWeight: config.outboundDependencyWeight,
      completionBonusWeight: config.completionBonusWeight,
      completionBonusCap: config.completionBonusCap,
      excessiveRejectionThreshold: config.excessiveRejectionThreshold,
    });

    const saved: KpiPeriodScore[] = [];
    for (const pair of pairs.values()) {
      const metrics = await this.computeMetrics(tenantId, pair.projectId, pair.assigneeUserId, range, config);

      let headlineScore: number | null = null;
      let auditScore: number | null = null;
      if (periodType === 'monthly') {
        const weeklyRows = await this.scoreRepository.find({
          where: { tenantId, projectId: pair.projectId, assigneeUserId: pair.assigneeUserId, periodType: 'weekly', periodStart: Between(startStr, endStr) },
        });
        if (weeklyRows.length > 0) {
          headlineScore = round2(weeklyRows.reduce((sum, r) => sum + Number(r.compositeScore), 0) / weeklyRows.length);
        }
        auditScore = metrics.compositeScore;
      }

      const row = this.scoreRepository.create({
        tenantId,
        projectId: pair.projectId,
        projectName: pair.projectName,
        assigneeUserId: pair.assigneeUserId,
        assigneeEmail: pair.assigneeEmail,
        periodType,
        periodStart: startStr,
        periodEnd: endStr,
        ...metrics,
        headlineScore,
        auditScore,
        weightsSnapshot,
        generatedByUserId: generatedByUserId ?? null,
      });
      saved.push(await this.scoreRepository.save(row));
    }

    return saved;
  }

  // ---------------------------------------------------------------
  // Reads. findMine() NEVER accepts an assigneeUserId from the caller -
  // it's always the id passed in by the controller from req.user.sub -
  // and never computes any cross-assignee aggregate. That split (not a
  // hidden UI field) is the actual access-control boundary.
  // ---------------------------------------------------------------

  findMine(tenantId: number, assigneeUserId: number, periodType?: KpiPeriodType, projectId?: number): Promise<KpiPeriodScore[]> {
    const where: any = { tenantId, assigneeUserId };
    if (periodType) where.periodType = periodType;
    if (projectId) where.projectId = projectId;
    return this.scoreRepository.find({ where, order: { periodStart: 'DESC' } });
  }

  findReport(tenantId: number, periodType?: KpiPeriodType, projectId?: number, assigneeUserId?: number): Promise<KpiPeriodScore[]> {
    const where: any = { tenantId };
    if (periodType) where.periodType = periodType;
    if (projectId) where.projectId = projectId;
    if (assigneeUserId) where.assigneeUserId = assigneeUserId;
    return this.scoreRepository.find({ where, order: { periodStart: 'DESC' } });
  }
}
