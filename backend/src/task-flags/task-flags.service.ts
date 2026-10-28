import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { TaskFlag } from './task-flag.entity';
import { Project } from '../projects/project.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import {
  FLAG_CLEARING_STATUSES,
  FLAG_REASON_MIN,
  TASK_FLAG_AUDIT,
  TaskFlagSetEvent,
  canClearFlag,
  flagPermissions,
} from './task-flags';
import { ClearTaskFlagDto, SetTaskFlagDto } from './dto/task-flags.dto';

// Team Tasks badges - the roles that see Team Tasks.
const OPEN_FLAGS_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.PROGRAM_MANAGER];

// Performance Tracking S3 - see ./task-flags.ts for the rules.
@Injectable()
export class TaskFlagsService {
  constructor(
    @InjectRepository(TaskFlag)
    private flagsRepository: Repository<TaskFlag>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private dataSource: DataSource,
  ) {}

  private async trackingOn(projectId: number, tenantId: number): Promise<boolean> {
    const project = await this.dataSource.getRepository(Project).findOne({ where: { id: projectId, tenantId } });
    return !!project?.performanceTrackingEnabled;
  }

  private async viewable(taskId: number, user: User, tenantId: number): Promise<ProjectTask> {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (!(await this.tasksService.canView(task, user))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return task;
  }

  private reasonOf(text: string | undefined, what: string): string {
    const trimmed = (text || '').trim();
    if (trimmed.length < FLAG_REASON_MIN) {
      throw new BadRequestException(`${what} must be at least ${FLAG_REASON_MIN} characters.`);
    }
    return trimmed;
  }

  // Everything the task page needs in one call.
  async state(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    const trackingOn = await this.trackingOn(task.projectId, tenantId);
    const flags = await this.flagsRepository.find({ where: { taskId, tenantId }, order: { setAt: 'DESC', id: 'DESC' } });
    const users = await this.usersService.findByIds(
      [...new Set(flags.flatMap((f) => [f.setByUserId, f.clearedByUserId, f.blockingOwnerUserId]).filter((id): id is number => id != null))],
      tenantId,
    );
    const names = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    const open = flags.filter((f) => f.clearedAt === null);
    const view = (f: TaskFlag) => ({
      ...f,
      setByName: names.get(f.setByUserId) ?? null,
      clearedByName: f.clearedByUserId ? names.get(f.clearedByUserId) ?? null : null,
      blockingOwnerName: f.blockingOwnerUserId ? names.get(f.blockingOwnerUserId) ?? null : f.blockingOwnerExternal,
      canClear: trackingOn && f.clearedAt === null && canClearFlag(f, task, user),
    });
    return {
      trackingOn,
      risk: open.find((f) => f.kind === 'risk') ? view(open.find((f) => f.kind === 'risk')!) : null,
      blocker: open.find((f) => f.kind === 'blocker') ? view(open.find((f) => f.kind === 'blocker')!) : null,
      history: flags.map(view),
      reasonMin: FLAG_REASON_MIN,
      ...flagPermissions(task, user, trackingOn, open),
    };
  }

  async set(dto: SetTaskFlagDto, user: User, tenantId: number) {
    const task = await this.viewable(dto.taskId, user, tenantId);
    this.tasksService.assertNotJunk(task);
    if (!(await this.trackingOn(task.projectId, tenantId))) {
      throw new BadRequestException('Performance Tracking is off for this project.');
    }
    if (FLAG_CLEARING_STATUSES.includes(task.status)) {
      throw new BadRequestException(`#${task.id} is ${task.status} - it can no longer be flagged.`);
    }
    const isAssignee = task.assigneeUserId === user.id;
    if (!isAssignee && ![UserRole.ADMIN, UserRole.PROGRAM_MANAGER].includes(user.role)) {
      throw new ForbiddenException('Only the assignee, a Program Manager or an Admin can flag this task.');
    }
    const reason = this.reasonOf(dto.reason, 'The reason');

    const row: Partial<TaskFlag> = {
      tenantId,
      taskId: task.id,
      projectId: task.projectId,
      kind: dto.kind,
      reason,
      assigneeUserId: task.assigneeUserId ?? null,
      committedDueDateAtSet: task.dueDate ?? null,
      setByUserId: user.id,
      setByAssignee: isAssignee,
    };
    let blockingOwner: User | null = null;
    if (dto.kind === 'risk') {
      if (dto.blockingOwnerUserId != null || dto.blockingOwnerExternal || dto.dependencyTicketId != null) {
        throw new BadRequestException('A risk has no blocking owner or dependency ticket.');
      }
      row.likelyDueDate = dto.likelyDueDate ?? null;
    } else {
      if (dto.likelyDueDate) throw new BadRequestException('A likely new date goes on a risk, not a blocker.');
      const externalName = (dto.blockingOwnerExternal || '').trim();
      if ((dto.blockingOwnerUserId != null) === !!externalName) {
        throw new BadRequestException('Pick who it is waiting on: a person in the tracker, or an outside party by name - one of the two.');
      }
      if (dto.blockingOwnerUserId != null) {
        blockingOwner = await this.usersService.findByIdAndTenant(dto.blockingOwnerUserId, tenantId);
        if (!blockingOwner || blockingOwner.role === UserRole.CLIENT) throw new NotFoundException(`User #${dto.blockingOwnerUserId} not found`);
        if (blockingOwner.id === task.assigneeUserId) throw new BadRequestException('The assignee cannot be blocking their own task.');
        Object.assign(row, { blockingOwnerUserId: blockingOwner.id, external: false });
      } else {
        Object.assign(row, { blockingOwnerExternal: externalName, external: true });
      }
      if (dto.dependencyTicketId != null) {
        const ticket = await this.dataSource
          .getRepository(TaskDependencyTicket)
          .findOne({ where: { id: dto.dependencyTicketId, tenantId, parentTaskId: task.id } });
        if (!ticket) throw new BadRequestException(`Dependency ticket #${dto.dependencyTicketId} is not on #${task.id}.`);
        if (ticket.status !== 'open') throw new BadRequestException('That dependency ticket is already resolved.');
        row.dependencyTicketId = ticket.id;
      }
    }

    let flagId = 0;
    try {
      await this.dataSource.transaction(async (em) => {
        const inserted = await em.insert(TaskFlag, row);
        flagId = inserted.identifiers[0].id;
        await this.auditLogService.recordWithin(em, {
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: TASK_FLAG_AUDIT.SET,
          tenantId,
          entityType: 'ProjectTask',
          entityId: task.id,
          details: {
            flagId,
            kind: dto.kind,
            reason,
            likelyDueDate: row.likelyDueDate ?? null,
            blockingOwnerUserId: row.blockingOwnerUserId ?? null,
            blockingOwnerExternal: row.blockingOwnerExternal ?? null,
            dependencyTicketId: row.dependencyTicketId ?? null,
            setByAssignee: isAssignee,
          },
        });
        if (blockingOwner) {
          await this.auditLogService.recordWithin(em, {
            userId: user.id,
            userEmail: user.email,
            userRole: user.role,
            action: TASK_FLAG_AUDIT.BLOCKER_VIEW_GRANTED,
            tenantId,
            entityType: 'ProjectTask',
            entityId: task.id,
            details: { flagId, blockingOwnerUserId: blockingOwner.id, blockingOwnerEmail: blockingOwner.email },
          });
        }
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new BadRequestException(`#${task.id} already has an open ${dto.kind} - reload to see it.`);
      }
      throw err;
    }
    const event: TaskFlagSetEvent = {
      tenantId,
      taskId: task.id,
      title: task.title,
      flagId,
      kind: dto.kind,
      reason,
      blockingOwnerUserId: blockingOwner?.id ?? null,
      actorUserId: user.id,
      actorEmail: user.email,
    };
    this.eventEmitter.emit('task.flagSet', event);
    return this.state(task.id, user, tenantId);
  }

  async clear(flagId: number, dto: ClearTaskFlagDto, user: User, tenantId: number) {
    const flag = await this.flagsRepository.findOne({ where: { id: flagId, tenantId } });
    if (!flag) throw new NotFoundException(`Flag #${flagId} not found`);
    const task = await this.viewable(flag.taskId, user, tenantId);
    if (flag.clearedAt) throw new BadRequestException('This flag is already cleared - reload to see it.');
    if (!(await this.trackingOn(task.projectId, tenantId))) {
      throw new BadRequestException('Performance Tracking is off for this project.');
    }
    if (!canClearFlag(flag, task, user)) {
      throw new ForbiddenException('Only whoever set it, the assignee, a Program Manager or an Admin can clear this flag.');
    }
    const note = (dto.note || '').trim() || null;
    await this.dataSource.transaction(async (em) => {
      const updated = await em.update(
        TaskFlag,
        { id: flag.id, clearedAt: IsNull() },
        { clearedAt: new Date(), clearedByUserId: user.id, clearNote: note, clearReason: 'manual' },
      );
      if (!updated.affected) throw new BadRequestException('This flag was just cleared - reload to see it.');
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TASK_FLAG_AUDIT.CLEARED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: { flagId: flag.id, kind: flag.kind, note },
      });
      if (flag.kind === 'blocker' && flag.blockingOwnerUserId) {
        await this.auditLogService.recordWithin(em, {
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: TASK_FLAG_AUDIT.BLOCKER_VIEW_ENDED,
          tenantId,
          entityType: 'ProjectTask',
          entityId: task.id,
          details: { flagId: flag.id, blockingOwnerUserId: flag.blockingOwnerUserId },
        });
      }
    });
    // A blocking owner who could only see the task through this blocker
    // has just lost that access.
    if (!(await this.tasksService.canView(task, user))) return { cleared: true, canViewTask: false };
    return this.state(task.id, user, tenantId);
  }

  // Team Tasks badges: open flags and proposed Due dates on the given
  // tasks, in projects with tracking ON.
  async open(taskIds: number[], user: User, tenantId: number) {
    if (!OPEN_FLAGS_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only Admin, Executive or Program Manager can list flags across tasks.');
    }
    if (taskIds.length === 0) return { items: [], proposedTaskIds: [] };
    const tracked = await this.dataSource.getRepository(Project).find({ where: { tenantId, performanceTrackingEnabled: true } });
    const trackedIds = tracked.map((p) => p.id);
    if (trackedIds.length === 0) return { items: [], proposedTaskIds: [] };
    const flags = await this.flagsRepository.find({ where: { tenantId, taskId: In(taskIds), projectId: In(trackedIds), clearedAt: IsNull() } });
    // Proposed Due dates (2026-10-28): dated, assigned, not yet committed
    // by the current assignee.
    const proposed: Array<{ id: number }> = await this.dataSource.query(
      `SELECT id FROM "project_tasks" WHERE "tenantId" = $1 AND id = ANY($2) AND "projectId" = ANY($3)
          AND "dueDate" IS NOT NULL AND "assigneeUserId" IS NOT NULL AND "dueDateCommittedByUserId" IS DISTINCT FROM "assigneeUserId"`,
      [tenantId, taskIds, trackedIds],
    );
    return {
      items: flags.map((f) => ({ taskId: f.taskId, kind: f.kind, external: f.external, reason: f.reason })),
      proposedTaskIds: proposed.map((r) => r.id),
    };
  }
}
