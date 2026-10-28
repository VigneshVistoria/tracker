import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { Project } from '../projects/project.entity';
import { TasksService } from './tasks.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import {
  DECLINE_REASON_MIN,
  IMPROVEMENT_DECIDE_ROLES,
  TASK_FIELDS_AUDIT,
  TASK_TEXT_EDIT_ROLES,
  TASK_TYPE_EDIT_ROLES,
  fieldProblems,
  isSelfInitiatedImprovement,
  missingBeforeSubmission,
  parseTaskType,
} from './task-fields';
import { ImprovementDecisionDto, UpdateTaskFieldsDto } from './dto/task-fields.dto';

// Performance Tracking S4b - task type, requirement ID, client impact and
// the PM's improvement decision. See ./task-fields.ts.
@Injectable()
export class TaskFieldsService {
  constructor(
    private tasksService: TasksService,
    private usersService: UsersService,
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

  private async openTask(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    this.tasksService.assertNotJunk(task);
    if (task.isDefect) throw new BadRequestException('A defect has no type, requirement ID or client impact.');
    if (!(await this.trackingOn(task.projectId, tenantId))) throw new BadRequestException('Performance Tracking is off for this project.');
    return task;
  }

  private async creatorRole(task: ProjectTask, tenantId: number) {
    const creator = task.createdByUserId ? await this.usersService.findByIdAndTenant(task.createdByUserId, tenantId) : null;
    return creator?.role ?? null;
  }

  async state(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    const trackingOn = !task.isDefect && (await this.trackingOn(task.projectId, tenantId));
    const selfInitiated = isSelfInitiatedImprovement(task, await this.creatorRole(task, tenantId));
    const decider = task.improvementDecidedByUserId ? await this.usersService.findByIdAndTenant(task.improvementDecidedByUserId, tenantId) : null;
    return {
      trackingOn,
      taskType: task.taskType,
      requirementId: task.requirementId,
      clientImpact: task.clientImpact,
      selfInitiatedImprovement: selfInitiated,
      improvementDecision: task.improvementDecision,
      improvementDecidedAt: task.improvementDecidedAt,
      improvementDecidedByName: decider ? decider.fullName || decider.email : null,
      improvementDeclineReason: task.improvementDeclineReason,
      missingBeforeSubmission: trackingOn ? missingBeforeSubmission(task) : [],
      canEditType: trackingOn && TASK_TYPE_EDIT_ROLES.includes(user.role),
      canEditTexts: trackingOn && (TASK_TEXT_EDIT_ROLES.includes(user.role) || task.assigneeUserId === user.id),
      canDecide: trackingOn && selfInitiated && IMPROVEMENT_DECIDE_ROLES.includes(user.role),
    };
  }

  // Type: PM only. Requirement ID / client impact: PM or the assignee.
  async update(taskId: number, dto: UpdateTaskFieldsDto, user: User, tenantId: number) {
    const task = await this.openTask(taskId, user, tenantId);
    const changes: Partial<ProjectTask> = {};
    if (dto.taskType !== undefined) {
      if (!TASK_TYPE_EDIT_ROLES.includes(user.role)) throw new ForbiddenException('Only a Program Manager or Admin can change the type.');
      const taskType = parseTaskType(dto.taskType);
      if (!taskType) throw new BadRequestException('Type must be Feature, Improvement or Other.');
      if (taskType !== task.taskType) changes.taskType = taskType;
    }
    if (dto.requirementId !== undefined || dto.clientImpact !== undefined) {
      if (!TASK_TEXT_EDIT_ROLES.includes(user.role) && task.assigneeUserId !== user.id) {
        throw new ForbiddenException('Only a Program Manager or the assignee can edit the requirement ID and client impact.');
      }
      const problems = fieldProblems(dto);
      if (problems.length) throw new BadRequestException(problems.join(' '));
      if (dto.requirementId !== undefined && ((dto.requirementId || '').trim() || null) !== task.requirementId) {
        changes.requirementId = (dto.requirementId || '').trim() || null;
      }
      if (dto.clientImpact !== undefined && ((dto.clientImpact || '').trim() || null) !== task.clientImpact) {
        changes.clientImpact = (dto.clientImpact || '').trim() || null;
      }
    }
    if (Object.keys(changes).length === 0) return this.state(taskId, user, tenantId);
    const before = Object.fromEntries(Object.keys(changes).map((k) => [k, (task as any)[k] ?? null]));
    await this.dataSource.transaction(async (em) => {
      await em.update(ProjectTask, { id: task.id, tenantId }, changes);
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TASK_FIELDS_AUDIT.FIELDS_UPDATED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: { before, after: changes },
      });
    });
    return this.state(taskId, user, tenantId);
  }

  // O5: a PM accepts or declines an Improvement a developer created.
  async decide(taskId: number, dto: ImprovementDecisionDto, user: User, tenantId: number) {
    if (!IMPROVEMENT_DECIDE_ROLES.includes(user.role)) throw new ForbiddenException('Only a Program Manager or Admin can accept or decline an improvement.');
    const task = await this.openTask(taskId, user, tenantId);
    if (!isSelfInitiatedImprovement(task, await this.creatorRole(task, tenantId))) {
      throw new BadRequestException('Only an Improvement a developer created can be accepted or declined.');
    }
    const reason = (dto.reason || '').trim();
    if (dto.decision === 'declined' && reason.length < DECLINE_REASON_MIN) {
      throw new BadRequestException(`Declining needs a reason of at least ${DECLINE_REASON_MIN} characters.`);
    }
    if (dto.decision === task.improvementDecision) throw new BadRequestException(`This improvement is already ${dto.decision}.`);
    await this.dataSource.transaction(async (em) => {
      await em.update(
        ProjectTask,
        { id: task.id, tenantId },
        {
          improvementDecision: dto.decision,
          improvementDecidedByUserId: user.id,
          improvementDecidedAt: new Date(),
          improvementDeclineReason: dto.decision === 'declined' ? reason : null,
        },
      );
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TASK_FIELDS_AUDIT.IMPROVEMENT_DECIDED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: { decision: dto.decision, previousDecision: task.improvementDecision, reason: dto.decision === 'declined' ? reason : null },
      });
    });
    return this.state(taskId, user, tenantId);
  }
}
