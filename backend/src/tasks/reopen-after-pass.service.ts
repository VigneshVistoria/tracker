import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { Project } from '../projects/project.entity';
import { TaskReopen } from './task-reopen.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TEAM_SETTINGS_DEFAULTS, dateInZone, isValidTimeZone } from '../team-settings/time-zone';
import { TasksService } from './tasks.service';
import { User } from '../users/user.entity';
import { AuditActions, AuditLogService } from '../audit/audit-log.service';
import { QA_INTAKE_AUDIT, REOPEN_FROM_STATUSES, REOPEN_REASON_MIN, REOPEN_ROLES, REOPEN_TO_STATUS, TaskReopenedEvent } from './qa-intake';
import { ReopenAfterPassDto } from './dto/reopen-after-pass.dto';

// Performance Tracking S4 - PM/Admin "Reopen after Pass", see ./qa-intake.ts.
@Injectable()
export class ReopenAfterPassService {
  constructor(
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    @InjectRepository(TeamSettings)
    private teamSettingsRepository: Repository<TeamSettings>,
    private tasksService: TasksService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private dataSource: DataSource,
  ) {}

  private async today(tenantId: number): Promise<string> {
    const settings = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    return dateInZone(new Date(), isValidTimeZone(settings?.timeZone) ? settings!.timeZone : TEAM_SETTINGS_DEFAULTS.timeZone);
  }

  async reopen(taskId: number, dto: ReopenAfterPassDto, user: User, tenantId: number) {
    if (!REOPEN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only a Program Manager or Admin can reopen a task after Pass.');
    }
    const task = await this.tasksService.findOne(taskId, tenantId);
    this.tasksService.assertNotJunk(task);
    const project = await this.dataSource.getRepository(Project).findOne({ where: { id: task.projectId, tenantId } });
    if (!project?.performanceTrackingEnabled) {
      throw new BadRequestException('Performance Tracking is off for this project.');
    }
    if (!REOPEN_FROM_STATUSES.includes(task.status)) {
      throw new BadRequestException(`Only a task that passed (Pass or Released) can be reopened - #${taskId} is ${task.status}.`);
    }
    const reason = (dto.reason || '').trim();
    if (reason.length < REOPEN_REASON_MIN) {
      throw new BadRequestException(`The reason must be at least ${REOPEN_REASON_MIN} characters.`);
    }
    if (dto.dueDate < (await this.today(tenantId))) {
      throw new BadRequestException('The new Due date cannot be in the past.');
    }

    // The round that passed it, and so the developer whose work passed
    // (charged in Q3 even if the task was reassigned since).
    const passed = await this.qaReviewsRepository.findOne({
      where: { taskId, tenantId, reviewType: In(['qa', 'peer']), status: 'approved' },
      order: { roundNumber: 'DESC' },
    });

    let reopenId = 0;
    await this.dataSource.transaction(async (em) => {
      const updated = await em.update(
        ProjectTask,
        { id: taskId, tenantId, status: task.status },
        {
          status: REOPEN_TO_STATUS,
          completedAt: null as any,
          qaReviewDueDate: null as any,
          reopenCount: (task.reopenCount || 0) + 1,
          // A new commitment: the date is a proposal until the assignee
          // confirms it or sets their own.
          dueDate: dto.dueDate,
          dueDateCommittedByUserId: null,
          dueDateCommittedAt: null,
        },
      );
      if (!updated.affected) throw new BadRequestException(`#${taskId} changed while you were on it - reload and try again.`);
      const inserted = await em.insert(TaskReopen, {
        tenantId,
        taskId,
        projectId: task.projectId,
        fromStatus: task.status,
        reason,
        reopenedByUserId: user.id,
        passedRoundId: passed?.id ?? null,
        passedAt: passed?.reviewedAt ?? task.completedAt ?? null,
        chargedUserId: passed?.submittedByUserId ?? null,
        assigneeUserId: task.assigneeUserId ?? null,
        previousDueDate: task.dueDate ?? null,
        proposedDueDate: dto.dueDate,
      });
      reopenId = inserted.identifiers[0].id;
      const actor = { userId: user.id, userEmail: user.email, userRole: user.role, tenantId, entityType: 'ProjectTask', entityId: taskId };
      if (dto.dueDate !== task.dueDate) {
        // Same shape as a form edit, so the date-history log records the
        // proposal (a PM/Admin change - never charged to the developer).
        await this.auditLogService.recordWithin(em, {
          ...actor,
          action: AuditActions.TASK_UPDATED,
          details: { previous: { ...task }, updated: { dueDate: dto.dueDate }, dueDateProposed: true, reopenAfterPass: true },
        });
      }
      await this.auditLogService.recordWithin(em, {
        ...actor,
        action: QA_INTAKE_AUDIT.REOPENED_AFTER_PASS,
        details: {
          reopenId,
          fromStatus: task.status,
          toStatus: REOPEN_TO_STATUS,
          reason,
          proposedDueDate: dto.dueDate,
          previousDueDate: task.dueDate ?? null,
          passedRoundId: passed?.id ?? null,
          chargedUserId: passed?.submittedByUserId ?? null,
          reopenCount: (task.reopenCount || 0) + 1,
        },
      });
    });

    const event: TaskReopenedEvent = {
      tenantId,
      taskId,
      title: task.title,
      reason,
      proposedDueDate: dto.dueDate,
      assigneeUserId: task.assigneeUserId ?? null,
      passedByQaUserId: passed?.reviewedByUserId ?? null,
      actorUserId: user.id,
      actorEmail: user.email,
    };
    this.eventEmitter.emit('task.reopenedAfterPass', event);
    return { task: await this.tasksService.findOne(taskId, tenantId), reopenId };
  }

  // The task page: past reopens.
  async list(taskId: number, tenantId: number) {
    return this.dataSource.getRepository(TaskReopen).find({ where: { taskId, tenantId }, order: { reopenedAt: 'DESC', id: 'DESC' } });
  }
}
