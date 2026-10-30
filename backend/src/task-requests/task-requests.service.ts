import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { TaskRequest } from './task-request.entity';
import { REQUEST_CLOSED_STATUSES, REQUEST_TEXT_MIN, RESPONSE_TEXT_MIN, TASK_REQUEST_AUDIT, TaskRequestEvent } from './task-requests';
import { AnswerTaskRequestDto, CreateTaskRequestDto } from './dto/task-requests.dto';

// B4 - requests on a task (C1). See ./task-requests.ts for the rules.
@Injectable()
export class TaskRequestsService {
  constructor(
    @InjectRepository(TaskRequest) private requestsRepository: Repository<TaskRequest>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private dataSource: DataSource,
  ) {}

  private async trackingOn(projectId: number, tenantId: number) {
    const project = await this.dataSource.getRepository(Project).findOne({ where: { id: projectId, tenantId } });
    return !!project?.performanceTrackingEnabled;
  }

  private async viewable(taskId: number, user: User, tenantId: number): Promise<ProjectTask> {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (!(await this.tasksService.canView(task, user))) throw new ForbiddenException('You do not have access to this task.');
    return task;
  }

  private text(value: string | undefined, min: number, what: string) {
    const t = (value || '').trim();
    if (t.length < min) throw new BadRequestException(`${what} must be at least ${min} characters.`);
    return t;
  }

  private emit(e: TaskRequestEvent) {
    this.eventEmitter.emit('task.request', e);
  }

  async state(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    if (!(await this.trackingOn(task.projectId, tenantId))) return { trackingOn: false };
    const [requests, tickets] = await Promise.all([
      this.requestsRepository.find({ where: { taskId, tenantId }, order: { requestedAt: 'DESC', id: 'DESC' } }),
      this.dataSource.getRepository(TaskDependencyTicket).find({ where: { parentTaskId: taskId, tenantId } }),
    ]);
    const users = await this.usersService.findByIds([...new Set(requests.flatMap((r) => [r.requestedOfUserId, r.requestedByUserId]))], tenantId);
    const names = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    const answeredTickets = new Set(requests.filter((r) => r.source === 'dependency').map((r) => r.dependencyTicketId));
    return {
      trackingOn: true,
      canAsk: user.role !== UserRole.CLIENT && !REQUEST_CLOSED_STATUSES.includes(task.status),
      textMin: REQUEST_TEXT_MIN,
      responseMin: RESPONSE_TEXT_MIN,
      requests: requests.map((r) => ({
        ...r,
        requestedOfName: names.get(r.requestedOfUserId) ?? null,
        requestedByName: names.get(r.requestedByUserId) ?? null,
        canAnswer: r.source === 'request' && !r.respondedAt && r.requestedOfUserId === user.id,
      })),
      // Open dependency tickets the viewer owns and hasn't answered yet.
      dependenciesToAnswer: tickets
        .filter((t) => t.ownerUserId === user.id && t.status === 'open' && !answeredTickets.has(t.id) && t.createdByUserId !== user.id)
        .map((t) => ({ id: t.id, title: t.title, createdAt: t.createdAt })),
    };
  }

  async create(taskId: number, dto: CreateTaskRequestDto, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    this.tasksService.assertNotJunk(task);
    if (!(await this.trackingOn(task.projectId, tenantId))) throw new BadRequestException('Performance Tracking is off for this project.');
    if (user.role === UserRole.CLIENT) throw new ForbiddenException('Clients cannot make requests here.');
    if (dto.requestedOfUserId === user.id) throw new BadRequestException('You cannot send a request to yourself.');
    const target = await this.usersService.findByIdAndTenant(dto.requestedOfUserId, tenantId);
    if (!target || target.role === UserRole.CLIENT) throw new NotFoundException(`User #${dto.requestedOfUserId} not found`);
    const body = this.text(dto.body, REQUEST_TEXT_MIN, 'The request');
    let requestId = 0;
    await this.dataSource.transaction(async (em) => {
      const inserted = await em.insert(TaskRequest, { tenantId, taskId: task.id, projectId: task.projectId, source: 'request', requestedOfUserId: target.id, requestedByUserId: user.id, body });
      requestId = inserted.identifiers[0].id;
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TASK_REQUEST_AUDIT.CREATED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: { requestId, requestedOfUserId: target.id },
      });
    });
    this.emit({ tenantId, taskId: task.id, title: task.title, requestId, kind: 'created', recipientUserId: target.id, text: body, actorUserId: user.id, actorEmail: user.email });
    return this.state(task.id, user, tenantId);
  }

  async answer(requestId: number, dto: AnswerTaskRequestDto, user: User, tenantId: number) {
    const request = await this.requestsRepository.findOne({ where: { id: requestId, tenantId } });
    if (!request) throw new NotFoundException(`Request #${requestId} not found`);
    const task = await this.viewable(request.taskId, user, tenantId);
    if (request.source !== 'request' || request.requestedOfUserId !== user.id) throw new ForbiddenException('Only the person asked can answer this request.');
    if (request.respondedAt) throw new BadRequestException('This request is already answered - reload to see it.');
    const body = this.text(dto.body, RESPONSE_TEXT_MIN, 'The answer');
    await this.dataSource.transaction(async (em) => {
      const updated = await em.update(TaskRequest, { id: request.id, respondedAt: IsNull() }, { respondedAt: new Date(), responseBody: body });
      if (!updated.affected) throw new BadRequestException('This request was just answered - reload to see it.');
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TASK_REQUEST_AUDIT.ANSWERED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: { requestId: request.id },
      });
    });
    this.emit({ tenantId, taskId: task.id, title: task.title, requestId: request.id, kind: 'answered', recipientUserId: request.requestedByUserId, text: body, actorUserId: user.id, actorEmail: user.email });
    return this.state(task.id, user, tenantId);
  }

  // The owner of a dependency ticket answers it without resolving it.
  async answerDependency(ticketId: number, dto: AnswerTaskRequestDto, user: User, tenantId: number) {
    const ticket = await this.dataSource.getRepository(TaskDependencyTicket).findOne({ where: { id: ticketId, tenantId } });
    if (!ticket) throw new NotFoundException(`Dependency ticket #${ticketId} not found`);
    const task = await this.viewable(ticket.parentTaskId, user, tenantId);
    if (!(await this.trackingOn(task.projectId, tenantId))) throw new BadRequestException('Performance Tracking is off for this project.');
    if (ticket.ownerUserId !== user.id) throw new ForbiddenException('Only the owner of this dependency can answer it.');
    if (ticket.status !== 'open') throw new BadRequestException('This dependency is already resolved.');
    const body = this.text(dto.body, RESPONSE_TEXT_MIN, 'The answer');
    let requestId = 0;
    try {
      await this.dataSource.transaction(async (em) => {
        const inserted = await em.insert(TaskRequest, {
          tenantId,
          taskId: task.id,
          projectId: task.projectId,
          source: 'dependency',
          dependencyTicketId: ticket.id,
          requestedOfUserId: ticket.ownerUserId,
          requestedByUserId: ticket.createdByUserId,
          body: ticket.title,
          requestedAt: ticket.createdAt,
          respondedAt: new Date(),
          responseBody: body,
        });
        requestId = inserted.identifiers[0].id;
        await this.auditLogService.recordWithin(em, {
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: TASK_REQUEST_AUDIT.DEPENDENCY_ANSWERED,
          tenantId,
          entityType: 'ProjectTask',
          entityId: task.id,
          details: { requestId, dependencyTicketId: ticket.id },
        });
      });
    } catch (err: any) {
      if (err?.code === '23505') throw new BadRequestException('This dependency is already answered - reload to see it.');
      throw err;
    }
    if (ticket.createdByUserId && ticket.createdByUserId !== user.id) {
      this.emit({ tenantId, taskId: task.id, title: task.title, requestId, kind: 'answered', recipientUserId: ticket.createdByUserId, text: body, actorUserId: user.id, actorEmail: user.email });
    }
    return this.state(task.id, user, tenantId);
  }
}
