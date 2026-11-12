import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, Not, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksService } from '../tasks/tasks.service';
import { TASK_TITLE_MAX_LENGTH } from '../tasks/task-title.constants';
import { User, UserRole } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { PerformanceTrackingService } from '../performance-tracking/performance-tracking.service';
import { TaskArtifactType } from '../task-qa-reviews/task-qa-review.entity';
import { TaskHandover } from './task-handover.entity';
import { TaskHandoverEvent } from './task-handovers';
import {
  DESIGN_HANDOVER_AUDIT,
  DESIGN_HANDOVER_BLOCKED_STATUSES,
  DESIGN_HANDOVER_ON_BEHALF_ROLES,
  DESIGN_HANDOVER_RECEIVER_ROLES,
  artifactsProblem,
} from './design-handovers';
import { AcceptDesignHandoverDto, RejectHandoverDto, StartDesignHandoverDto } from './dto/task-handovers.dto';

const nameOf = (u: User | undefined) => (u ? u.fullName || u.email : 'Unknown');
const ARTIFACT_TYPES = Object.values(TaskArtifactType) as string[];
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// "Hand over to development" - see ./design-handovers.ts.
@Injectable()
export class DesignHandoversService {
  constructor(
    @InjectRepository(TaskHandover) private handovers: Repository<TaskHandover>,
    @InjectRepository(User) private users: Repository<User>,
    private tasksService: TasksService,
    private tracking: PerformanceTrackingService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private dataSource: DataSource,
  ) {}

  private emit(e: TaskHandoverEvent) {
    this.eventEmitter.emit('task.handover', { ...e, design: true });
  }

  private async viewable(taskId: number, user: User, tenantId: number): Promise<ProjectTask> {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (!(await this.tasksService.canView(task, user))) throw new ForbiddenException('You do not have access to this task.');
    return task;
  }

  private async assigneeRole(task: ProjectTask, tenantId: number): Promise<UserRole | null> {
    if (!task.assigneeUserId) return null;
    return (await this.users.findOne({ where: { id: task.assigneeUserId, tenantId } }))?.role ?? null;
  }

  // Why this task can't be handed over right now, or null.
  private async blocker(task: ProjectTask, tenantId: number): Promise<string | null> {
    if ((await this.assigneeRole(task, tenantId)) !== UserRole.DESIGNER) return 'Only a task assigned to a Designer can be handed over to development.';
    if (task.isDefect) return 'A defect cannot be handed over to development.';
    if (task.dependencyTicketId != null) return 'A dependency task cannot be handed over to development.';
    if (DESIGN_HANDOVER_BLOCKED_STATUSES.includes(task.status)) {
      return ['Pass', 'Closed', 'Junk', 'Hold'].includes(task.status) || task.status.startsWith('Released')
        ? `A ${task.status} task cannot be handed over.`
        : `The task is in ${task.status} - wait for that review to finish first.`;
    }
    return null;
  }

  private async receivers(tenantId: number) {
    const people = await this.users.find({ where: { tenantId, role: In(DESIGN_HANDOVER_RECEIVER_ROLES) }, order: { fullName: 'ASC' } });
    return people.filter((u) => u.email !== process.env.SMOKE_TEST_EMAIL);
  }

  // The receiver's own open tasks in the design task's project - what
  // they can link on accept.
  private async linkableTasks(designTask: ProjectTask, receiverId: number, tenantId: number) {
    return this.dataSource.getRepository(ProjectTask).find({
      where: {
        tenantId,
        projectId: designTask.projectId,
        assigneeUserId: receiverId,
        id: Not(designTask.id),
        status: Not(In(['Pass', 'Closed', 'Junk', 'Released - No Showstoppers', 'Released - With Showstoppers'])),
      },
      select: ['id', 'title', 'status'],
      order: { id: 'DESC' },
      take: 200,
    });
  }

  private present(r: TaskHandover, names: Map<number, User>, user: User) {
    return {
      id: r.id,
      taskId: r.taskId,
      status: r.status,
      fromName: nameOf(names.get(r.fromUserId)),
      toUserId: r.toUserId,
      toName: nameOf(names.get(r.toUserId)),
      startedByName: nameOf(names.get(r.startedByUserId)),
      notes: r.whatDone,
      artifacts: r.artifacts ?? [],
      linkedTaskId: r.linkedTaskId,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      decidedByName: r.decidedByUserId ? nameOf(names.get(r.decidedByUserId)) : null,
      rejectReason: r.rejectReason,
      canDecide: r.status === 'pending' && r.toUserId === user.id,
      canCancel: r.status === 'pending' && (r.fromUserId === user.id || r.startedByUserId === user.id || DESIGN_HANDOVER_ON_BEHALF_ROLES.includes(user.role)),
    };
  }

  private async names(rows: TaskHandover[], tenantId: number) {
    const ids = new Set<number>(rows.flatMap((r) => [r.fromUserId, r.toUserId, r.startedByUserId, ...(r.decidedByUserId ? [r.decidedByUserId] : [])]));
    return new Map((ids.size ? await this.users.find({ where: { tenantId, id: In([...ids]) } }) : []).map((u) => [u.id, u]));
  }

  // GET tasks/:id/design-handover - on a design task its handovers (and
  // whether one can be started); on a development task the design
  // handovers linked to it.
  async state(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    const fieldMin = (await this.tracking.thresholds(tenantId)).handoverFieldMin;
    const own = await this.handovers.find({ where: { tenantId, taskId, kind: 'design' }, order: { createdAt: 'DESC', id: 'DESC' } });
    const incoming = await this.handovers.find({ where: { tenantId, linkedTaskId: taskId, kind: 'design', status: 'accepted' }, order: { decidedAt: 'DESC', id: 'DESC' } });
    const names = await this.names([...own, ...incoming], tenantId);
    const isDesignTask = (await this.assigneeRole(task, tenantId)) === UserRole.DESIGNER || own.some((r) => r.status === 'accepted');
    const anyPending = await this.handovers.count({ where: { tenantId, taskId, status: 'pending' } });
    const mayStart = task.assigneeUserId === user.id || DESIGN_HANDOVER_ON_BEHALF_ROLES.includes(user.role);
    const blocker = await this.blocker(task, tenantId);
    const pendingForMe = own.find((r) => r.status === 'pending' && r.toUserId === user.id);
    return {
      isDesignTask,
      fieldMin,
      canStart: mayStart && !anyPending && !blocker,
      // Shown to whoever could start one, so the button can say why not.
      startBlockedReason: mayStart && isDesignTask ? (anyPending ? 'A handover is already waiting for a decision.' : blocker) : null,
      receivers: mayStart ? (await this.receivers(tenantId)).filter((u) => u.id !== task.assigneeUserId).map((u) => ({ id: u.id, name: nameOf(u), role: u.role })) : [],
      artifactTypes: ARTIFACT_TYPES,
      handovers: own.map((r) => this.present(r, names, user)),
      linkedFrom: incoming.map((r) => this.present(r, names, user)),
      linkableTasks: pendingForMe ? await this.linkableTasks(task, user.id, tenantId) : [],
    };
  }

  async start(taskId: number, dto: StartDesignHandoverDto, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    if (task.assigneeUserId !== user.id && !DESIGN_HANDOVER_ON_BEHALF_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only the designer on the task or a Program Manager can hand it over to development.');
    }
    const blocker = await this.blocker(task, tenantId);
    if (blocker) throw new BadRequestException(blocker);
    if (dto.toUserId === task.assigneeUserId) throw new BadRequestException('Pick someone else to hand it over to.');
    if (!(await this.receivers(tenantId)).some((u) => u.id === dto.toUserId)) throw new BadRequestException('Hand it over to a Developer or DevOps account.');
    const min = (await this.tracking.thresholds(tenantId)).handoverFieldMin;
    const notes = (dto.notes || '').trim();
    if (notes.length < min) throw new BadRequestException(`Write handover notes (at least ${min} characters).`);
    const problem = artifactsProblem(dto.artifacts, ARTIFACT_TYPES);
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
          whatDone: notes,
          howToTest: '',
          knownIssues: '',
          dependencies: '',
          environment: '',
          kind: 'design',
          artifacts: dto.artifacts.map((a) => ({ type: a.type, url: a.url.trim() })),
          status: 'pending',
        }),
      );
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: DESIGN_HANDOVER_AUDIT.STARTED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: taskId,
        details: { handoverId: row.id, fromUserId: row.fromUserId, toUserId: row.toUserId, artifacts: row.artifacts!.length },
      });
    });
    this.emit({ tenantId, taskId, title: task.title, kind: 'started', recipientUserId: dto.toUserId, actorUserId: user.id, actorEmail: user.email });
    return this.state(taskId, user, tenantId);
  }

  private async pendingDesign(handoverId: number, tenantId: number) {
    const h = await this.handovers.findOne({ where: { id: handoverId, tenantId } });
    if (!h || h.kind !== 'design') throw new NotFoundException(`Design handover #${handoverId} not found.`);
    if (h.status !== 'pending') throw new BadRequestException(`This handover was already ${h.status}.`);
    return h;
  }

  async accept(handoverId: number, dto: AcceptDesignHandoverDto, user: User, tenantId: number) {
    const h = await this.pendingDesign(handoverId, tenantId);
    if (h.toUserId !== user.id) throw new ForbiddenException('Only the developer it was handed to can accept it.');
    const design = await this.tasksService.findOne(h.taskId, tenantId);
    if (design.assigneeUserId !== h.fromUserId) throw new BadRequestException('The design task was reassigned since this handover was started - ask for a new one.');
    const blocker = await this.blocker(design, tenantId);
    if (blocker) throw new BadRequestException(blocker);

    const title = (dto.newTaskTitle || '').trim();
    if ((dto.linkTaskId != null) === !!title) throw new BadRequestException('Link one of your tasks or give the new task a title (one of them).');
    let linked: ProjectTask | null = null;
    if (dto.linkTaskId != null) {
      linked = (await this.linkableTasks(design, user.id, tenantId)).find((t) => t.id === dto.linkTaskId) ?? null;
      if (!linked) throw new BadRequestException('Link an open task of yours in the same project.');
    } else if (title.length > TASK_TITLE_MAX_LENGTH) {
      throw new BadRequestException(`Title must be ${TASK_TITLE_MAX_LENGTH} characters or fewer.`);
    }

    const now = new Date();
    await this.dataSource.transaction(async (em) => {
      // Only a still-pending row changes (two clicks at once: one wins).
      const res = await em.update(TaskHandover, { id: h.id, status: 'pending' }, { status: 'accepted', decidedAt: now, decidedByUserId: user.id, linkedTaskId: linked?.id ?? null });
      if (!res.affected) throw new BadRequestException('This handover was already decided.');
      await em.update(ProjectTask, { id: design.id, tenantId }, { status: 'Pass', completedAt: now, designHandoverId: h.id });
      const base = { userId: user.id, userEmail: user.email, userRole: user.role, tenantId, entityType: 'ProjectTask' };
      await this.auditLogService.recordWithin(em, { ...base, action: DESIGN_HANDOVER_AUDIT.ACCEPTED, entityId: design.id, details: { handoverId: h.id, fromUserId: h.fromUserId, toUserId: h.toUserId, linkedTaskId: linked?.id ?? null } });
      await this.auditLogService.recordWithin(em, { ...base, action: DESIGN_HANDOVER_AUDIT.TASK_CLOSED, entityId: design.id, details: { handoverId: h.id, previousStatus: design.status, newStatus: 'Pass' } });
    });

    let linkedTaskId = linked?.id ?? null;
    if (!linked) {
      // A new task for the developer: same project/module/phase, the
      // handover in its description. Created after the handover is closed
      // so a double click can't make two.
      const project = await this.dataSource.getRepository(Project).findOne({ where: { id: design.projectId, tenantId } });
      const links = (h.artifacts ?? []).map((a) => `<li>${escapeHtml(a.type)}: <a href="${escapeHtml(a.url)}">${escapeHtml(a.url)}</a></li>`).join('');
      const created = await this.tasksService.create(
        {
          projectId: design.projectId,
          moduleId: design.moduleId,
          phaseId: design.phaseId,
          title,
          description: `<p>Development of design task #${design.id} (${escapeHtml(design.title)}), handed over by ${escapeHtml(nameOf(await this.users.findOne({ where: { id: h.fromUserId, tenantId } }) ?? undefined))}.</p><p>${escapeHtml(h.whatDone)}</p>${links ? `<ul>${links}</ul>` : ''}`,
          assigneeUserId: user.id,
          ...(project?.performanceTrackingEnabled ? { taskType: design.taskType ?? 'feature' } : {}),
        } as any,
        user,
        tenantId,
      );
      linkedTaskId = created.id;
      await this.handovers.update({ id: h.id }, { linkedTaskId });
    }
    this.emit({ tenantId, taskId: design.id, title: design.title, kind: 'accepted', recipientUserId: h.fromUserId, actorUserId: user.id, actorEmail: user.email, linkedTaskId });
    return { linkedTaskId, designTaskId: design.id, ...(await this.state(design.id, user, tenantId)) };
  }

  async reject(handoverId: number, dto: RejectHandoverDto, user: User, tenantId: number) {
    const h = await this.pendingDesign(handoverId, tenantId);
    if (h.toUserId !== user.id) throw new ForbiddenException('Only the developer it was handed to can reject it.');
    const min = (await this.tracking.thresholds(tenantId)).handoverFieldMin;
    const reason = (dto.reason || '').trim();
    if (reason.length < min) throw new BadRequestException(`Say what is missing (at least ${min} characters).`);
    await this.close(h, 'rejected', DESIGN_HANDOVER_AUDIT.REJECTED, user, tenantId, reason);
    const task = await this.tasksService.findOne(h.taskId, tenantId);
    this.emit({ tenantId, taskId: h.taskId, title: task.title, kind: 'rejected', recipientUserId: h.fromUserId, actorUserId: user.id, actorEmail: user.email, reason });
    return this.afterDecision(h.taskId, user, tenantId);
  }

  async cancel(handoverId: number, user: User, tenantId: number) {
    const h = await this.pendingDesign(handoverId, tenantId);
    if (h.fromUserId !== user.id && h.startedByUserId !== user.id && !DESIGN_HANDOVER_ON_BEHALF_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only the designer, whoever started it or a Program Manager can cancel the handover.');
    }
    await this.close(h, 'cancelled', DESIGN_HANDOVER_AUDIT.CANCELLED, user, tenantId, null);
    const task = await this.tasksService.findOne(h.taskId, tenantId);
    this.emit({ tenantId, taskId: h.taskId, title: task.title, kind: 'cancelled', recipientUserId: h.toUserId, actorUserId: user.id, actorEmail: user.email });
    return this.afterDecision(h.taskId, user, tenantId);
  }

  private async close(h: TaskHandover, status: 'rejected' | 'cancelled', action: string, user: User, tenantId: number, reason: string | null) {
    await this.dataSource.transaction(async (em) => {
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

  // After a reject/cancel the receiver's view access ends.
  private async afterDecision(taskId: number, user: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (!(await this.tasksService.canView(task, user))) return { decided: true, canViewTask: false };
    return this.state(taskId, user, tenantId);
  }
}
