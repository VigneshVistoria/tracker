import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { Project } from '../projects/project.entity';
import { DueDateChangeRequest } from './due-date-change-request.entity';
import { TaskCommitmentEvent } from '../performance-metrics/task-commitment-event.entity';
import { TasksService } from './tasks.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { AuditActions, AuditLogService } from '../audit/audit-log.service';
import {
  DUE_DATE_AUDIT,
  DUE_DATE_DECIDE_ROLES,
  DUE_DATE_FROZEN_STATUSES,
  DUE_DATE_REASON_MIN,
  DueDateChangeDecidedEvent,
  DueDateChangeRequestedEvent,
  DueDateChangedDirectEvent,
  commitmentState,
  dueDatePermissions,
} from './due-date-change';
import { CommitDueDateDto, DueDateChangeDto, DueDateDecisionDto } from './dto/due-date-change.dto';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Performance Tracking S2 - see ./due-date-change.ts for the rules.
@Injectable()
export class DueDateChangeService {
  constructor(
    @InjectRepository(DueDateChangeRequest)
    private requestsRepository: Repository<DueDateChangeRequest>,
    @InjectRepository(TaskCommitmentEvent)
    private commitmentEventsRepository: Repository<TaskCommitmentEvent>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private dataSource: DataSource,
  ) {}

  async trackingOn(projectId: number, tenantId: number): Promise<boolean> {
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

  private pending(taskId: number, tenantId: number) {
    return this.requestsRepository.findOne({ where: { taskId, tenantId, status: 'pending' } });
  }

  private reasonOf(text: string | undefined, what: string): string {
    const trimmed = (text || '').trim();
    if (trimmed.length < DUE_DATE_REASON_MIN) {
      throw new BadRequestException(`${what} must be at least ${DUE_DATE_REASON_MIN} characters.`);
    }
    return trimmed;
  }

  private dateOf(value: string): string {
    if (!DATE_ONLY_RE.test(value || '')) throw new BadRequestException('Due date must be YYYY-MM-DD.');
    return value;
  }

  private async namesFor(ids: Array<number | null | undefined>, tenantId: number): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => id != null))];
    const users = unique.length ? await this.usersService.findByIds(unique, tenantId) : [];
    return new Map(users.map((u) => [u.id, u.fullName || u.email]));
  }

  // Everything the task page needs in one call.
  async state(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    const trackingOn = await this.trackingOn(task.projectId, tenantId);
    const [requests, events] = await Promise.all([
      this.requestsRepository.find({ where: { taskId, tenantId }, order: { createdAt: 'DESC', id: 'DESC' } }),
      this.commitmentEventsRepository.find({
        where: { taskId, tenantId, kind: In(['due_set', 'due_changed', 'due_cleared']) },
        order: { occurredAt: 'DESC', id: 'DESC' },
      }),
    ]);
    const pending = requests.find((r) => r.status === 'pending') || null;
    const names = await this.namesFor(
      [
        task.dueDateCommittedByUserId,
        ...requests.flatMap((r) => [r.requestedByUserId, r.decidedByUserId, r.assigneeUserId]),
        ...events.map((e) => e.actorUserId),
      ],
      tenantId,
    );
    const requestView = (r: DueDateChangeRequest) => ({
      ...r,
      requestedByName: names.get(r.requestedByUserId) ?? null,
      decidedByName: r.decidedByUserId ? names.get(r.decidedByUserId) ?? null : null,
    });
    return {
      trackingOn,
      dueDate: task.dueDate ?? null,
      state: commitmentState(task),
      committedByUserId: task.dueDateCommittedByUserId ?? null,
      committedByName: task.dueDateCommittedByUserId ? names.get(task.dueDateCommittedByUserId) ?? null : null,
      committedAt: task.dueDateCommittedAt ?? null,
      frozen: DUE_DATE_FROZEN_STATUSES.includes(task.status),
      pending: pending ? requestView(pending) : null,
      requests: requests.map(requestView),
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        oldDueDate: e.oldDueDate,
        newDueDate: e.newDueDate,
        occurredAt: e.occurredAt,
        actorName: e.actorUserId ? names.get(e.actorUserId) ?? null : null,
      })),
      reasonMin: DUE_DATE_REASON_MIN,
      ...dueDatePermissions(task, user, trackingOn, pending),
    };
  }

  // PM/Admin: every pending request, longest waiting first.
  async queue(user: User, tenantId: number) {
    if (!DUE_DATE_DECIDE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an Admin or Program Manager can see date change requests.');
    }
    const requests = await this.requestsRepository.find({ where: { tenantId, status: 'pending' }, order: { createdAt: 'ASC', id: 'ASC' } });
    const tasks = await this.tasksService.findManyByIds([...new Set(requests.map((r) => r.taskId))], tenantId);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const names = await this.namesFor(requests.flatMap((r) => [r.requestedByUserId, r.assigneeUserId]), tenantId);
    return {
      items: requests.map((r) => {
        const t = taskById.get(r.taskId);
        return {
          id: r.id,
          taskId: r.taskId,
          title: t?.title ?? '',
          projectName: t?.projectName ?? '',
          status: t?.status ?? '',
          requestedByName: names.get(r.requestedByUserId) ?? null,
          // The viewer's own request - another PM/Admin must decide it.
          own: r.requestedByUserId === user.id,
          currentDueDate: r.currentDueDate,
          requestedDueDate: r.requestedDueDate,
          direction: r.requestedDueDate > r.currentDueDate ? 'later' : 'earlier',
          reason: r.reason,
          createdAt: r.createdAt,
        };
      }),
    };
  }

  // Writes the new date (only if the task still has the date and assignee
  // the caller saw) and its TASK_UPDATED entry - the same shape a form edit
  // writes, so task_commitment_events records it. Returns the entry's id.
  private async applyDate(
    em: EntityManager,
    task: ProjectTask,
    newDate: string,
    actor: User,
    tenantId: number,
    extra: Record<string, unknown>,
    alsoCommit = false,
  ): Promise<number> {
    const changes: Partial<ProjectTask> = { dueDate: newDate };
    if (alsoCommit) Object.assign(changes, { dueDateCommittedByUserId: actor.id, dueDateCommittedAt: new Date() });
    const updated = await em.update(
      ProjectTask,
      { id: task.id, tenantId, dueDate: task.dueDate, assigneeUserId: task.assigneeUserId ?? undefined },
      changes,
    );
    if (!updated.affected) {
      throw new BadRequestException(`#${task.id} changed while you were on it - reload and try again.`);
    }
    return this.auditLogService.recordWithin(em, {
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: AuditActions.TASK_UPDATED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: task.id,
      details: { previous: { ...task }, updated: { dueDate: newDate }, ...extra },
    });
  }

  private audit(em: EntityManager, actor: User, tenantId: number, taskId: number, action: string, details: Record<string, unknown>) {
    return this.auditLogService.recordWithin(em, {
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details,
    });
  }

  private async openTask(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    this.tasksService.assertNotJunk(task);
    if (!(await this.trackingOn(task.projectId, tenantId))) {
      throw new BadRequestException('Performance Tracking is off for this project - edit the Due date on the task form.');
    }
    if (DUE_DATE_FROZEN_STATUSES.includes(task.status)) {
      throw new BadRequestException(`#${taskId} is ${task.status} - its Due date can no longer change.`);
    }
    return task;
  }

  // Assignee: the one free set or confirmation of a date they have not
  // committed to yet (after a reassignment, or a date the PM set).
  async commit(taskId: number, dto: CommitDueDateDto, user: User, tenantId: number) {
    const task = await this.openTask(taskId, user, tenantId);
    if (task.assigneeUserId !== user.id) throw new ForbiddenException('Only the assignee can commit to the Due date.');
    if (commitmentState(task) !== 'needs_commitment') {
      throw new BadRequestException('Your Due date is already committed - request a change instead.');
    }
    const newDate = this.dateOf(dto.dueDate);
    await this.dataSource.transaction(async (em) => {
      if (newDate === task.dueDate) {
        const updated = await em.update(
          ProjectTask,
          { id: task.id, tenantId, dueDate: task.dueDate, assigneeUserId: user.id },
          { dueDateCommittedByUserId: user.id, dueDateCommittedAt: new Date() },
        );
        if (!updated.affected) throw new BadRequestException(`#${task.id} changed while you were on it - reload and try again.`);
      } else {
        await this.applyDate(em, task, newDate, user, tenantId, { dueDateCommitment: true }, true);
      }
      await this.audit(em, user, tenantId, task.id, DUE_DATE_AUDIT.COMMITTED, {
        previousDueDate: task.dueDate,
        dueDate: newDate,
        confirmed: newDate === task.dueDate,
        previousCommittedByUserId: task.dueDateCommittedByUserId ?? null,
      });
    });
    return this.state(taskId, user, tenantId);
  }

  // Assignee: ask for a new date (pending until decided). PM/Admin: change
  // it directly, with a reason - unless the task is their own, then they
  // ask too and another PM/Admin decides.
  async change(taskId: number, dto: DueDateChangeDto, user: User, tenantId: number) {
    const task = await this.openTask(taskId, user, tenantId);
    const newDate = this.dateOf(dto.dueDate);
    if (!task.dueDate) throw new BadRequestException(`#${taskId} has no Due date yet - set it on the task form.`);
    if (newDate === task.dueDate) throw new BadRequestException('That is already the Due date.');
    const reason = this.reasonOf(dto.reason, 'The reason');

    if (DUE_DATE_DECIDE_ROLES.includes(user.role) && task.assigneeUserId !== user.id) {
      const pending = await this.pending(taskId, tenantId);
      await this.dataSource.transaction(async (em) => {
        if (pending) {
          await em.update(
            DueDateChangeRequest,
            { id: pending.id, status: 'pending' },
            { status: 'cancelled', cancelReason: 'superseded', decidedByUserId: user.id, decidedAt: new Date() },
          );
        }
        const auditLogId = await this.applyDate(em, task, newDate, user, tenantId, { dueDateChangeReason: reason, direct: true });
        await em.insert(DueDateChangeRequest, {
          tenantId,
          taskId,
          projectId: task.projectId,
          kind: 'direct',
          assigneeUserId: task.assigneeUserId ?? null,
          requestedByUserId: user.id,
          currentDueDate: task.dueDate,
          requestedDueDate: newDate,
          reason,
          status: 'approved',
          decidedByUserId: user.id,
          decidedAt: new Date(),
          auditLogId,
        });
        await this.audit(em, user, tenantId, taskId, AuditActions.TASK_DUE_DATE_EDITED, {
          previousDueDate: task.dueDate,
          newDueDate: newDate,
          reason,
        });
        await this.audit(em, user, tenantId, taskId, DUE_DATE_AUDIT.CHANGED_DIRECT, {
          previousDueDate: task.dueDate,
          newDueDate: newDate,
          reason,
          supersededRequestId: pending?.id ?? null,
        });
      });
      const event: DueDateChangedDirectEvent = {
        tenantId,
        taskId,
        title: task.title,
        assigneeUserId: task.assigneeUserId ?? null,
        oldDueDate: task.dueDate,
        newDueDate: newDate,
        reason,
        actorUserId: user.id,
        actorEmail: user.email,
      };
      this.eventEmitter.emit('task.dueDateChangedDirect', event);
      return this.state(taskId, user, tenantId);
    }

    if (task.assigneeUserId !== user.id) {
      throw new ForbiddenException('Only the assignee can ask to change the Due date.');
    }
    if (commitmentState(task) !== 'committed') {
      throw new BadRequestException('You have not committed to this Due date yet - set or confirm it first.');
    }
    let requestId = 0;
    try {
      await this.dataSource.transaction(async (em) => {
        const inserted = await em.insert(DueDateChangeRequest, {
          tenantId,
          taskId,
          projectId: task.projectId,
          kind: 'request',
          assigneeUserId: user.id,
          requestedByUserId: user.id,
          currentDueDate: task.dueDate,
          requestedDueDate: newDate,
          reason,
          status: 'pending',
        });
        requestId = inserted.identifiers[0].id;
        await this.audit(em, user, tenantId, taskId, DUE_DATE_AUDIT.REQUESTED, {
          requestId,
          currentDueDate: task.dueDate,
          requestedDueDate: newDate,
          reason,
        });
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new BadRequestException('There is already a pending date change request on this task - reload to see it.');
      }
      throw err;
    }
    const event: DueDateChangeRequestedEvent = {
      tenantId,
      taskId,
      title: task.title,
      requestId,
      requesterUserId: user.id,
      requesterEmail: user.email,
      currentDueDate: task.dueDate,
      requestedDueDate: newDate,
      reason,
    };
    this.eventEmitter.emit('task.dueDateChangeRequested', event);
    return this.state(taskId, user, tenantId);
  }

  private async pendingRequest(requestId: number, tenantId: number) {
    const request = await this.requestsRepository.findOne({ where: { id: requestId, tenantId } });
    if (!request) throw new NotFoundException(`Request #${requestId} not found`);
    if (request.status !== 'pending') {
      throw new BadRequestException(`This request is already ${request.status} - reload to see it.`);
    }
    return request;
  }

  // Nobody decides their own request (a PM/Admin asking about a task
  // assigned to them, or someone who became PM after asking).
  private assertNotOwn(request: DueDateChangeRequest, user: User) {
    if (request.requestedByUserId === user.id) {
      throw new ForbiddenException('You cannot decide your own date change request - another Program Manager or Admin must.');
    }
  }

  // Marks the request decided, only if it is still pending.
  private async closeRequest(em: EntityManager, request: DueDateChangeRequest, changes: Partial<DueDateChangeRequest>) {
    const updated = await em.update(DueDateChangeRequest, { id: request.id, status: 'pending' }, changes);
    if (!updated.affected) throw new BadRequestException('This request was just decided or cancelled - reload to see it.');
  }

  async approve(requestId: number, dto: DueDateDecisionDto, user: User, tenantId: number) {
    if (!DUE_DATE_DECIDE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an Admin or Program Manager can approve a date change.');
    }
    const request = await this.pendingRequest(requestId, tenantId);
    this.assertNotOwn(request, user);
    const task = await this.tasksService.findOne(request.taskId, tenantId);
    if (task.dueDate !== request.currentDueDate || task.assigneeUserId !== request.assigneeUserId) {
      throw new BadRequestException(`#${task.id} changed since the request was made - reload and try again.`);
    }
    const note = (dto.note || '').trim() || null;
    await this.dataSource.transaction(async (em) => {
      const auditLogId = await this.applyDate(em, task, request.requestedDueDate, user, tenantId, {
        dueDateChangeRequestId: request.id,
        dueDateChangeReason: request.reason,
        requestedByUserId: request.requestedByUserId,
      });
      await this.closeRequest(em, request, { status: 'approved', decidedByUserId: user.id, decidedAt: new Date(), decisionNote: note, auditLogId });
      await this.audit(em, user, tenantId, task.id, AuditActions.TASK_DUE_DATE_EDITED, {
        previousDueDate: request.currentDueDate,
        newDueDate: request.requestedDueDate,
        reason: request.reason,
        requestId: request.id,
      });
      await this.audit(em, user, tenantId, task.id, DUE_DATE_AUDIT.APPROVED, {
        requestId: request.id,
        previousDueDate: request.currentDueDate,
        newDueDate: request.requestedDueDate,
        note,
      });
    });
    this.emitDecided(request, task, 'approved', note, user, tenantId);
    return this.state(task.id, user, tenantId);
  }

  async reject(requestId: number, dto: DueDateDecisionDto, user: User, tenantId: number) {
    if (!DUE_DATE_DECIDE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an Admin or Program Manager can reject a date change.');
    }
    const note = this.reasonOf(dto.note, 'The note');
    const request = await this.pendingRequest(requestId, tenantId);
    this.assertNotOwn(request, user);
    const task = await this.tasksService.findOne(request.taskId, tenantId);
    await this.dataSource.transaction(async (em) => {
      await this.closeRequest(em, request, { status: 'rejected', decidedByUserId: user.id, decidedAt: new Date(), decisionNote: note });
      await this.audit(em, user, tenantId, task.id, DUE_DATE_AUDIT.REJECTED, {
        requestId: request.id,
        currentDueDate: request.currentDueDate,
        requestedDueDate: request.requestedDueDate,
        note,
      });
    });
    this.emitDecided(request, task, 'rejected', note, user, tenantId);
    return this.state(task.id, user, tenantId);
  }

  async withdraw(requestId: number, user: User, tenantId: number) {
    const request = await this.pendingRequest(requestId, tenantId);
    if (request.requestedByUserId !== user.id) throw new ForbiddenException('Only the person who asked can withdraw it.');
    await this.dataSource.transaction(async (em) => {
      await this.closeRequest(em, request, { status: 'withdrawn', decidedByUserId: user.id, decidedAt: new Date() });
      await this.audit(em, user, tenantId, request.taskId, DUE_DATE_AUDIT.WITHDRAWN, { requestId: request.id });
    });
    return this.state(request.taskId, user, tenantId);
  }

  private emitDecided(request: DueDateChangeRequest, task: ProjectTask, decision: 'approved' | 'rejected', note: string | null, user: User, tenantId: number) {
    const event: DueDateChangeDecidedEvent = {
      tenantId,
      taskId: task.id,
      title: task.title,
      requestId: request.id,
      requesterUserId: request.requestedByUserId,
      decision,
      requestedDueDate: request.requestedDueDate,
      note,
      actorUserId: user.id,
      actorEmail: user.email,
    };
    this.eventEmitter.emit('task.dueDateChangeDecided', event);
  }
}

