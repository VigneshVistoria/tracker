import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { TaskUatResult } from './task-uat-result.entity';
import { ReleaseSatisfaction } from './release-satisfaction.entity';
import { TaskPriorityTierEvent } from './task-priority-tier-event.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { Project } from '../projects/project.entity';
import { Release } from '../release-logs/release.entity';
import { TasksService } from '../tasks/tasks.service';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { PerformanceTrackingService } from '../performance-tracking/performance-tracking.service';
import { CLIENT_MEASURES_AUDIT, CLIENT_MEASURES_ROLES, answersProblem, averageOf } from './client-measures';
import { RecordUatResultDto, SaveReleaseSatisfactionDto, SetClientPriorityTierDto } from './dto/client-measures.dto';

const nameOf = (u: User | undefined) => (u ? u.fullName || u.email : 'Unknown');
const clean = (v: string | null | undefined) => (v ?? '').trim() || null;
const NOTE_MIN = 10;

// Performance Tracking L3-L5 - see ./client-measures.ts.
@Injectable()
export class ClientMeasuresService {
  constructor(
    @InjectRepository(TaskUatResult) private uat: Repository<TaskUatResult>,
    @InjectRepository(ReleaseSatisfaction) private satisfaction: Repository<ReleaseSatisfaction>,
    @InjectRepository(TaskPriorityTierEvent) private tierEvents: Repository<TaskPriorityTierEvent>,
    @InjectRepository(User) private users: Repository<User>,
    private tasksService: TasksService,
    private tracking: PerformanceTrackingService,
    private auditLogService: AuditLogService,
    private dataSource: DataSource,
  ) {}

  private async trackingOn(projectId: number, tenantId: number) {
    const project = await this.dataSource.getRepository(Project).findOne({ where: { id: projectId, tenantId } });
    return !!project?.performanceTrackingEnabled;
  }

  private async viewable(taskId: number, user: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (!(await this.tasksService.canView(task, user))) throw new ForbiddenException('You do not have access to this task.');
    return task;
  }

  private async names(ids: number[], tenantId: number) {
    return new Map((ids.length ? await this.users.find({ where: { tenantId, id: In([...new Set(ids)]) } }) : []).map((u) => [u.id, u]));
  }

  private assertManager(user: User) {
    if (!CLIENT_MEASURES_ROLES.includes(user.role)) throw new ForbiddenException('Only a Program Manager can record client measures.');
  }

  // ---- L3 / L4 on the task page ----
  async taskState(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    const trackingOn = await this.trackingOn(task.projectId, tenantId);
    const th = await this.tracking.thresholds(tenantId);
    const rounds = await this.uat.find({ where: { tenantId, taskId }, order: { round: 'ASC' } });
    const history = await this.tierEvents.find({ where: { tenantId, taskId }, order: { changedAt: 'ASC', id: 'ASC' } });
    const names = await this.names([...rounds.map((r) => r.recordedByUserId), ...history.map((h) => h.changedByUserId)], tenantId);
    const label = (tier: number | null) => (tier ? th.clientPriorityTiers[tier - 1] ?? `Tier ${tier}` : 'Not set');
    return {
      trackingOn,
      tiers: th.clientPriorityTiers,
      tier: task.clientPriorityTier,
      tierLabel: task.clientPriorityTier ? th.clientPriorityTiers[task.clientPriorityTier - 1] ?? `Tier ${task.clientPriorityTier}` : null,
      tierHistory: history.map((h) => ({ id: h.id, tierLabel: label(h.tier), previousLabel: label(h.previousTier), changedAt: h.changedAt, changedByName: nameOf(names.get(h.changedByUserId)) })),
      uatResults: rounds.map((r) => ({ id: r.id, round: r.round, result: r.result, note: r.note, recordedAt: r.recordedAt, recordedByName: nameOf(names.get(r.recordedByUserId)) })),
      canEdit: trackingOn && task.status !== 'Junk' && CLIENT_MEASURES_ROLES.includes(user.role),
    };
  }

  private async editable(taskId: number, user: User, tenantId: number) {
    this.assertManager(user);
    const task = await this.viewable(taskId, user, tenantId);
    this.tasksService.assertNotJunk(task);
    if (!(await this.trackingOn(task.projectId, tenantId))) throw new BadRequestException('Performance Tracking is off for this project.');
    return task;
  }

  async setTier(taskId: number, dto: SetClientPriorityTierDto, user: User, tenantId: number) {
    const task = await this.editable(taskId, user, tenantId);
    const th = await this.tracking.thresholds(tenantId);
    const tier = dto.tier ?? null;
    if (tier !== null && tier > th.clientPriorityTiers.length) throw new BadRequestException(`Pick one of the ${th.clientPriorityTiers.length} tiers.`);
    if (tier === task.clientPriorityTier) return this.taskState(taskId, user, tenantId);
    await this.dataSource.transaction(async (em) => {
      await em.update(ProjectTask, { id: task.id, tenantId }, { clientPriorityTier: tier });
      await em.save(em.create(TaskPriorityTierEvent, { tenantId, projectId: task.projectId, taskId: task.id, tier, previousTier: task.clientPriorityTier, changedByUserId: user.id }));
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: CLIENT_MEASURES_AUDIT.TIER_SET,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: {
          before: task.clientPriorityTier,
          after: tier,
          beforeLabel: task.clientPriorityTier ? th.clientPriorityTiers[task.clientPriorityTier - 1] ?? null : null,
          afterLabel: tier ? th.clientPriorityTiers[tier - 1] : null,
        },
      });
    });
    return this.taskState(taskId, user, tenantId);
  }

  async recordUat(taskId: number, dto: RecordUatResultDto, user: User, tenantId: number) {
    const task = await this.editable(taskId, user, tenantId);
    const note = clean(dto.note);
    if (dto.result === 'failed' && (note ?? '').length < NOTE_MIN) throw new BadRequestException(`Say what failed in UAT (at least ${NOTE_MIN} characters).`);
    await this.dataSource.transaction(async (em) => {
      const round = (await em.count(TaskUatResult, { where: { tenantId, taskId: task.id } })) + 1;
      const row = await em.save(em.create(TaskUatResult, { tenantId, projectId: task.projectId, taskId: task.id, round, result: dto.result, note, recordedByUserId: user.id }));
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: CLIENT_MEASURES_AUDIT.UAT_RECORDED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: { uatResultId: row.id, round, result: row.result, note },
      });
    });
    return this.taskState(taskId, user, tenantId);
  }

  // ---- L5 on the Release Log (Program Manager only, as the Release Log) ----
  private async release(releaseId: number, user: User, tenantId: number) {
    this.assertManager(user);
    const release = await this.dataSource.getRepository(Release).findOne({ where: { id: releaseId, tenantId } });
    if (!release) throw new NotFoundException(`Release #${releaseId} not found`);
    return release;
  }

  async releaseState(releaseId: number, user: User, tenantId: number) {
    const release = await this.release(releaseId, user, tenantId);
    const trackingOn = await this.trackingOn(release.projectId, tenantId);
    const th = await this.tracking.thresholds(tenantId);
    const row = await this.satisfaction.findOne({ where: { tenantId, releaseId } });
    const names = await this.names(row ? [row.recordedByUserId] : [], tenantId);
    return {
      trackingOn,
      // A saved response keeps the questions it answered.
      questions: row?.questions ?? th.satisfactionQuestions,
      response: row
        ? {
            scores: row.scores,
            average: Number(row.average),
            respondent: row.respondent,
            comment: row.comment,
            recordedAt: row.recordedAt,
            updatedAt: row.updatedAt,
            recordedByName: nameOf(names.get(row.recordedByUserId)),
          }
        : null,
      canEdit: trackingOn,
    };
  }

  async saveSatisfaction(releaseId: number, dto: SaveReleaseSatisfactionDto, user: User, tenantId: number) {
    const release = await this.release(releaseId, user, tenantId);
    if (!(await this.trackingOn(release.projectId, tenantId))) throw new BadRequestException('Performance Tracking is off for this project.');
    const th = await this.tracking.thresholds(tenantId);
    const existing = await this.satisfaction.findOne({ where: { tenantId, releaseId } });
    const questions = existing?.questions ?? th.satisfactionQuestions;
    const problem = answersProblem(dto.scores, questions);
    if (problem) throw new BadRequestException(problem);
    const next = { scores: dto.scores, average: String(averageOf(dto.scores)), respondent: clean(dto.respondent), comment: clean(dto.comment) };
    await this.dataSource.transaction(async (em) => {
      const row = existing
        ? (await em.update(ReleaseSatisfaction, { id: existing.id }, next), existing)
        : await em.save(em.create(ReleaseSatisfaction, { tenantId, projectId: release.projectId, releaseId, questions, ...next, recordedByUserId: user.id }));
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: CLIENT_MEASURES_AUDIT.SATISFACTION_SAVED,
        tenantId,
        entityType: 'Release',
        entityId: releaseId,
        details: {
          satisfactionId: row.id,
          questions,
          before: existing ? { scores: existing.scores, respondent: existing.respondent, comment: existing.comment } : null,
          after: { scores: next.scores, respondent: next.respondent, comment: next.comment },
        },
      });
    });
    return this.releaseState(releaseId, user, tenantId);
  }
}
