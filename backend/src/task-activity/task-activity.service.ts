import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { PerformanceTrackingService } from '../performance-tracking/performance-tracking.service';
import { TaskChase } from './task-chase.entity';
import { TaskProgressNote } from './task-progress-note.entity';
import { TASK_ACTIVITY_AUDIT, TaskChasedEvent, chaseBlockedReason, noteBlockedReason } from './task-activity';
import { AddProgressNoteDto, ChaseTaskDto } from './dto/task-activity.dto';

// Performance Tracking B1 - see ./task-activity.ts for the rules.
@Injectable()
export class TaskActivityService {
  constructor(
    @InjectRepository(TaskChase) private chasesRepository: Repository<TaskChase>,
    @InjectRepository(TaskProgressNote) private notesRepository: Repository<TaskProgressNote>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private tracking: PerformanceTrackingService,
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

  private async lastChaseBy(taskId: number, userId: number, tenantId: number): Promise<Date | null> {
    const last = await this.chasesRepository.findOne({ where: { taskId, chasedByUserId: userId, tenantId }, order: { createdAt: 'DESC', id: 'DESC' } });
    return last?.createdAt ?? null;
  }

  // Everything the task page needs in one call.
  async state(taskId: number, user: User, tenantId: number, now = new Date()) {
    const task = await this.viewable(taskId, user, tenantId);
    const trackingOn = await this.trackingOn(task.projectId, tenantId);
    if (!trackingOn) return { trackingOn: false };
    const settings = await this.tracking.thresholds(tenantId);
    const [chases, notes] = await Promise.all([
      this.chasesRepository.find({ where: { taskId, tenantId }, order: { createdAt: 'DESC', id: 'DESC' } }),
      this.notesRepository.find({ where: { taskId, tenantId }, order: { createdAt: 'DESC', id: 'DESC' } }),
    ]);
    const users = await this.usersService.findByIds(
      [...new Set([...chases.flatMap((c) => [c.chasedByUserId, c.assigneeUserId]), ...notes.map((n) => n.authorUserId)])],
      tenantId,
    );
    const names = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    const mine = chases.find((c) => c.chasedByUserId === user.id) ?? null;
    const chaseBlocked = chaseBlockedReason(task, user, settings.chaseRoles, mine?.createdAt ?? null, settings.chaseCooldownHours, now);
    const noteBlocked = noteBlockedReason(task, user);
    return {
      trackingOn: true,
      canChase: chaseBlocked === null,
      chaseBlockedReason: chaseBlocked,
      canAddNote: noteBlocked === null,
      progressNoteMin: settings.progressNoteMin,
      chaseCooldownHours: settings.chaseCooldownHours,
      chases: chases.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        note: c.note,
        taskStatus: c.taskStatus,
        chasedByName: names.get(c.chasedByUserId) ?? null,
        assigneeName: names.get(c.assigneeUserId) ?? null,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        createdAt: n.createdAt,
        body: n.body,
        taskStatus: n.taskStatus,
        authorName: names.get(n.authorUserId) ?? null,
      })),
    };
  }

  async chase(taskId: number, dto: ChaseTaskDto, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    this.tasksService.assertNotJunk(task);
    if (!(await this.trackingOn(task.projectId, tenantId))) {
      throw new BadRequestException('Performance Tracking is off for this project.');
    }
    const settings = await this.tracking.thresholds(tenantId);
    const blocked = chaseBlockedReason(task, user, settings.chaseRoles, await this.lastChaseBy(task.id, user.id, tenantId), settings.chaseCooldownHours, new Date());
    if (blocked) {
      throw blocked.startsWith('You cannot') || blocked.startsWith('Your role') ? new ForbiddenException(blocked) : new BadRequestException(blocked);
    }
    const note = (dto.note || '').trim() || null;
    let chaseId = 0;
    await this.dataSource.transaction(async (em) => {
      const inserted = await em.insert(TaskChase, {
        tenantId,
        taskId: task.id,
        projectId: task.projectId,
        assigneeUserId: task.assigneeUserId!,
        chasedByUserId: user.id,
        note,
        taskStatus: task.status,
      });
      chaseId = inserted.identifiers[0].id;
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TASK_ACTIVITY_AUDIT.CHASED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: { chaseId, assigneeUserId: task.assigneeUserId, note, taskStatus: task.status },
      });
    });
    const event: TaskChasedEvent = {
      tenantId,
      taskId: task.id,
      title: task.title,
      chaseId,
      assigneeUserId: task.assigneeUserId!,
      note,
      actorUserId: user.id,
      actorEmail: user.email,
    };
    this.eventEmitter.emit('task.chased', event);
    return this.state(task.id, user, tenantId);
  }

  async addNote(taskId: number, dto: AddProgressNoteDto, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    this.tasksService.assertNotJunk(task);
    if (!(await this.trackingOn(task.projectId, tenantId))) {
      throw new BadRequestException('Performance Tracking is off for this project.');
    }
    const blocked = noteBlockedReason(task, user);
    if (blocked) throw blocked.startsWith('Only') ? new ForbiddenException(blocked) : new BadRequestException(blocked);
    const settings = await this.tracking.thresholds(tenantId);
    const body = (dto.body || '').trim();
    if (body.length < settings.progressNoteMin) {
      throw new BadRequestException(`A progress note must be at least ${settings.progressNoteMin} characters.`);
    }
    await this.dataSource.transaction(async (em) => {
      const inserted = await em.insert(TaskProgressNote, {
        tenantId,
        taskId: task.id,
        projectId: task.projectId,
        authorUserId: user.id,
        body,
        taskStatus: task.status,
      });
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TASK_ACTIVITY_AUDIT.PROGRESS_NOTE_ADDED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: { noteId: inserted.identifiers[0].id, length: body.length, taskStatus: task.status },
      });
    });
    return this.state(task.id, user, tenantId);
  }
}
