import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksService } from '../tasks/tasks.service';
import { DEVELOPER_EQUIVALENT_ROLES, User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { PerformanceTrackingService } from '../performance-tracking/performance-tracking.service';
import { TaskHandover } from './task-handover.entity';
import {
  HANDOVER_AUDIT,
  HANDOVER_CLOSED_STATUSES,
  HANDOVER_FIELDS,
  HANDOVER_ON_BEHALF_ROLES,
  TaskHandoverEvent,
  templateProblem,
} from './task-handovers';
import { RejectHandoverDto, StartHandoverDto } from './dto/task-handovers.dto';

const nameOf = (u: User | undefined) => (u ? u.fullName || u.email : 'Unknown');

// Performance Tracking C4 - handover with a template; the next owner
// accepts or rejects. See ./task-handovers.ts.
@Injectable()
export class TaskHandoversService {
  constructor(
    @InjectRepository(TaskHandover) private handovers: Repository<TaskHandover>,
    @InjectRepository(User) private users: Repository<User>,
    private tasksService: TasksService,
    private tracking: PerformanceTrackingService,
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

  private emit(e: TaskHandoverEvent) {
    this.eventEmitter.emit('task.handover', e);
  }

  // Developer, Designer and DevOps accounts (smoke-test user left out).
  private async candidates(tenantId: number) {
    const people = await this.users.find({ where: { tenantId, role: In(DEVELOPER_EQUIVALENT_ROLES) }, order: { fullName: 'ASC' } });
    return people.filter((u) => u.email !== process.env.SMOKE_TEST_EMAIL);
  }

  async state(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    if (!(await this.trackingOn(task.projectId, tenantId))) return { trackingOn: false };
    const th = await this.tracking.thresholds(tenantId);
    const rows = await this.handovers.find({ where: { tenantId, taskId }, order: { createdAt: 'DESC', id: 'DESC' } });
    const ids = new Set<number>(rows.flatMap((r) => [r.fromUserId, r.toUserId, r.startedByUserId, ...(r.decidedByUserId ? [r.decidedByUserId] : [])]));
    const names = new Map((ids.size ? await this.users.find({ where: { tenantId, id: In([...ids]) } }) : []).map((u) => [u.id, u]));
    const pending = rows.find((r) => r.status === 'pending') ?? null;
    const open = !HANDOVER_CLOSED_STATUSES.includes(task.status);
    const mayStart = task.assigneeUserId === user.id || HANDOVER_ON_BEHALF_ROLES.includes(user.role);
    return {
      trackingOn: true,
      fieldMin: th.handoverFieldMin,
      canStart: open && !pending && !!task.assigneeUserId && mayStart,
      candidates: (await this.candidates(tenantId)).filter((u) => u.id !== task.assigneeUserId).map((u) => ({ id: u.id, name: nameOf(u) })),
      handovers: rows.map((r) => ({
        id: r.id,
        status: r.status,
        fromName: nameOf(names.get(r.fromUserId)),
        toUserId: r.toUserId,
        toName: nameOf(names.get(r.toUserId)),
        startedByName: nameOf(names.get(r.startedByUserId)),
        ...Object.fromEntries(HANDOVER_FIELDS.map((f) => [f, r[f]])),
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        decidedByName: r.decidedByUserId ? nameOf(names.get(r.decidedByUserId)) : null,
        rejectReason: r.rejectReason,
        canDecide: r.status === 'pending' && r.toUserId === user.id,
        canCancel: r.status === 'pending' && (r.fromUserId === user.id || r.startedByUserId === user.id || HANDOVER_ON_BEHALF_ROLES.includes(user.role)),
      })),
    };
  }

  async start(taskId: number, dto: StartHandoverDto, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    this.tasksService.assertNotJunk(task);
    if (!(await this.trackingOn(task.projectId, tenantId))) throw new BadRequestException('Performance Tracking is off for this project.');
    if (HANDOVER_CLOSED_STATUSES.includes(task.status)) throw new BadRequestException(`A ${task.status} task cannot be handed over.`);
    if (!task.assigneeUserId) throw new BadRequestException('The task has no assignee to hand it over.');
    if (task.assigneeUserId !== user.id && !HANDOVER_ON_BEHALF_ROLES.includes(user.role)) throw new ForbiddenException('Only the assignee, a PM or an Admin can hand a task over.');
    if (dto.toUserId === task.assigneeUserId) throw new BadRequestException('The next owner must be someone else.');
    if (!(await this.candidates(tenantId)).some((u) => u.id === dto.toUserId)) throw new BadRequestException('The next owner must be a Developer, Designer or DevOps account.');
    const th = await this.tracking.thresholds(tenantId);
    const problem = templateProblem(dto, th.handoverFieldMin);
    if (problem) throw new BadRequestException(problem);
    if (await this.handovers.count({ where: { tenantId, taskId, status: 'pending' } })) throw new BadRequestException('This task already has a handover waiting for a decision.');
    await this.dataSource.transaction(async (em) => {
      const row = await em.save(
        em.create(TaskHandover, {
          tenantId,
          taskId,
          projectId: task.projectId,
          fromUserId: task.assigneeUserId!,
          startedByUserId: user.id,
          toUserId: dto.toUserId,
          ...Object.fromEntries(HANDOVER_FIELDS.map((f) => [f, dto[f].trim()])),
          status: 'pending',
        }),
      );
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: HANDOVER_AUDIT.STARTED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: taskId,
        details: { handoverId: row.id, fromUserId: row.fromUserId, toUserId: row.toUserId },
      });
    });
    this.emit({ tenantId, taskId, title: task.title, kind: 'started', recipientUserId: dto.toUserId, actorUserId: user.id, actorEmail: user.email });
    return this.state(taskId, user, tenantId);
  }

  private async pending(handoverId: number, tenantId: number) {
    const h = await this.handovers.findOne({ where: { id: handoverId, tenantId } });
    if (!h) throw new NotFoundException(`Handover #${handoverId} not found.`);
    if (h.status !== 'pending') throw new BadRequestException(`This handover was already ${h.status}.`);
    return h;
  }

  private async close(h: TaskHandover, status: 'accepted' | 'rejected' | 'cancelled', user: User, tenantId: number, reason: string | null) {
    const action = status === 'accepted' ? HANDOVER_AUDIT.ACCEPTED : status === 'rejected' ? HANDOVER_AUDIT.REJECTED : HANDOVER_AUDIT.CANCELLED;
    await this.dataSource.transaction(async (em) => {
      // Only a still-pending row changes (two clicks at once: one wins).
      const res = await em.update(TaskHandover, { id: h.id, status: 'pending' }, { status, decidedAt: new Date(), decidedByUserId: user.id, rejectReason: reason });
      if (!res.affected) throw new BadRequestException('This handover was already decided.');
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action,
        tenantId,
        entityType: 'ProjectTask',
        entityId: h.taskId,
        details: { handoverId: h.id, fromUserId: h.fromUserId, toUserId: h.toUserId, reason },
      });
    });
  }

  async accept(handoverId: number, user: User, tenantId: number) {
    const h = await this.pending(handoverId, tenantId);
    if (h.toUserId !== user.id) throw new ForbiddenException('Only the next owner can accept the handover.');
    const task = await this.tasksService.findOne(h.taskId, tenantId);
    this.tasksService.assertNotJunk(task);
    if (task.assigneeUserId !== h.fromUserId) throw new BadRequestException('The task was reassigned since this handover was started - ask for a new one.');
    await this.close(h, 'accepted', user, tenantId, null);
    // The normal reassignment (audited; feeds the commitment history).
    await this.tasksService.reassignTeamTask(h.taskId, { assigneeUserId: user.id }, user, tenantId);
    this.emit({ tenantId, taskId: h.taskId, title: task.title, kind: 'accepted', recipientUserId: h.fromUserId, actorUserId: user.id, actorEmail: user.email });
    return this.state(h.taskId, user, tenantId);
  }

  async reject(handoverId: number, dto: RejectHandoverDto, user: User, tenantId: number) {
    const h = await this.pending(handoverId, tenantId);
    if (h.toUserId !== user.id) throw new ForbiddenException('Only the next owner can reject the handover.');
    const th = await this.tracking.thresholds(tenantId);
    const reason = (dto.reason || '').trim();
    if (reason.length < th.handoverFieldMin) throw new BadRequestException(`Say what is missing (at least ${th.handoverFieldMin} characters).`);
    const task = await this.tasksService.findOne(h.taskId, tenantId);
    await this.close(h, 'rejected', user, tenantId, reason);
    this.emit({ tenantId, taskId: h.taskId, title: task.title, kind: 'rejected', recipientUserId: h.fromUserId, actorUserId: user.id, actorEmail: user.email, reason });
    return this.stateAfterDecision(h.taskId, user, tenantId);
  }

  async cancel(handoverId: number, user: User, tenantId: number) {
    const h = await this.pending(handoverId, tenantId);
    if (h.fromUserId !== user.id && h.startedByUserId !== user.id && !HANDOVER_ON_BEHALF_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only whoever handed it over, a PM or an Admin can cancel the handover.');
    }
    const task = await this.tasksService.findOne(h.taskId, tenantId);
    await this.close(h, 'cancelled', user, tenantId, null);
    this.emit({ tenantId, taskId: h.taskId, title: task.title, kind: 'cancelled', recipientUserId: h.toUserId, actorUserId: user.id, actorEmail: user.email });
    return this.stateAfterDecision(h.taskId, user, tenantId);
  }

  // After a reject, the next owner's view access ends with it (as for a
  // cleared blocker in S3): say so instead of a 403.
  private async stateAfterDecision(taskId: number, user: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (!(await this.tasksService.canView(task, user))) return { decided: true, canViewTask: false };
    return this.state(taskId, user, tenantId);
  }
}
