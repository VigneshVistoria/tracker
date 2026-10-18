import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { TaskDefectArtifact } from './task-defect-artifact.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { TasksService, JUNK_STATUS } from './tasks.service';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { businessDaysBetween } from '../common/business-days';
import {
  RETURNED_TO_QA_STATUS,
  RETURN_TO_QA_AUDIT,
  RETURN_TO_QA_FROM_STATUSES,
  TaskReturnToQaSentBackEvent,
  TaskReturnedToQaEvent,
} from './return-to-qa';
import { AddDefectEvidenceDto, ReturnToQaDto, ReturnToQaSendBackDto } from './dto/return-to-qa.dto';

type Actor = { id: number; email: string; role: UserRole };

export interface CurrentReturn {
  qaUserId: number;
  qaEmail: string;
  reason: string;
  statusFrom: string;
  returnedByUserId: number;
  returnedByEmail: string;
  returnedAt: Date;
}

// See ./return-to-qa.ts for the rules.
@Injectable()
export class ReturnToQaService {
  constructor(
    @InjectRepository(TaskDefectArtifact)
    private defectArtifactsRepository: Repository<TaskDefectArtifact>,
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private dataSource: DataSource,
  ) {}

  // The latest return of this ticket (from its audit entry), or null.
  async currentReturn(taskId: number, tenantId: number): Promise<CurrentReturn | null> {
    const rows: Array<{ userId: number; userEmail: string; createdAt: Date; details: string | null }> = await this.dataSource.query(
      `SELECT "userId", "userEmail", "createdAt", details FROM audit_logs
        WHERE "tenantId" = $1 AND action = $2 AND "entityType" = 'ProjectTask' AND "entityId" = $3
        ORDER BY id DESC LIMIT 1`,
      [tenantId, RETURN_TO_QA_AUDIT.RETURNED, taskId],
    );
    if (!rows.length) return null;
    let details: any = {};
    try {
      details = rows[0].details ? JSON.parse(rows[0].details) : {};
    } catch {
      details = {};
    }
    if (!details.qaUserId) return null;
    return {
      qaUserId: details.qaUserId,
      qaEmail: details.qaEmail,
      reason: details.reason || '',
      statusFrom: details.statusFrom,
      returnedByUserId: rows[0].userId,
      returnedByEmail: rows[0].userEmail,
      returnedAt: new Date(rows[0].createdAt),
    };
  }

  // Who the PM's dialog suggests: a defect's raiser, else the QA who last
  // made a QA decision on the task (a reverted decision still names the
  // QA who looked at it). null = the PM must pick.
  async defaultQaUserId(task: ProjectTask): Promise<number | null> {
    if (task.isDefect && task.createdByUserId) {
      const raiser = await this.usersService.findByIdAndTenant(task.createdByUserId, task.tenantId);
      if (raiser?.role === UserRole.QA) return raiser.id;
    }
    const last = await this.qaReviewsRepository.findOne({
      where: { taskId: task.id, tenantId: task.tenantId, reviewType: 'qa', status: In(['approved', 'rejected', 'escalated', 'reverted']) },
      order: { roundNumber: 'DESC', id: 'DESC' },
    });
    return last?.reviewedByUserId ?? null;
  }

  // Everything the task page needs about this feature in one call.
  async state(taskId: number, currentUser: User, tenantId: number) {
    const task = await this.viewable(taskId, currentUser, tenantId);
    const current = task.status === RETURNED_TO_QA_STATUS ? await this.currentReturn(taskId, tenantId) : null;
    const defaultQaId = await this.defaultQaUserId(task);
    const defaultQa = defaultQaId ? await this.usersService.findByIdAndTenant(defaultQaId, tenantId) : null;
    const isPm = currentUser.role === UserRole.PROGRAM_MANAGER;
    const isReturnedQa = !!current && current.qaUserId === currentUser.id;
    return {
      current,
      defaultQa: defaultQa ? { id: defaultQa.id, email: defaultQa.email, fullName: defaultQa.fullName } : null,
      canReturn: isPm && RETURN_TO_QA_FROM_STATUSES.includes(task.status),
      canSendBack: task.status === RETURNED_TO_QA_STATUS && (isReturnedQa || isPm),
      canEditEvidence: task.isDefect && task.status === RETURNED_TO_QA_STATUS && isReturnedQa,
    };
  }

  async returnToQa(taskId: number, dto: ReturnToQaDto, currentUser: User, tenantId: number) {
    if (currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only a Program Manager can send a ticket back to QA.');
    }
    const reason = (dto.reason || '').trim();
    const task = await this.tasksService.findOne(taskId, tenantId);
    this.tasksService.assertNotJunk(task);
    const fromStatus = task.status;
    if (!RETURN_TO_QA_FROM_STATUSES.includes(fromStatus)) {
      throw new BadRequestException(
        fromStatus === RETURNED_TO_QA_STATUS
          ? `#${taskId} is already with QA - reload to see it.`
          : `#${taskId} is ${fromStatus} - only a ticket in Development, Failed or PM Feedback can be sent back to QA.`,
      );
    }
    const qaUserId = dto.qaUserId ?? (await this.defaultQaUserId(task));
    if (!qaUserId) {
      throw new BadRequestException(`No QA has worked on #${taskId} yet - pick the QA to send it to.`);
    }
    const qa = await this.usersService.findById(qaUserId);
    if (!qa || qa.tenantId !== tenantId) throw new NotFoundException(`User #${qaUserId} not found`);
    if (qa.role !== UserRole.QA) throw new BadRequestException('Send it to a QA user.');
    if (!(await this.tasksService.canView(task, qa))) {
      throw new BadRequestException(`${qa.fullName || qa.email} is not on this ticket's project - pick a QA who is.`);
    }

    await this.dataSource.transaction(async (em) => {
      const updated = await em.update(ProjectTask, { id: taskId, tenantId, status: fromStatus }, { status: RETURNED_TO_QA_STATUS });
      if (!updated.affected) {
        throw new BadRequestException(`#${taskId} changed while you were on it - reload and try again.`);
      }
      await this.auditLogService.recordWithin(em, {
        ...this.auditActor(currentUser, tenantId, taskId),
        action: RETURN_TO_QA_AUDIT.RETURNED,
        details: { reason, qaUserId: qa.id, qaEmail: qa.email, statusFrom: fromStatus, statusTo: RETURNED_TO_QA_STATUS },
      });
    });

    const event: TaskReturnedToQaEvent = {
      tenantId,
      taskId,
      title: task.title,
      qaUserId: qa.id,
      assigneeUserId: task.assigneeUserId ?? null,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email,
      reason,
    };
    this.eventEmitter.emit('task.returnedToQa', event);
    return { task: await this.tasksService.findOne(taskId, tenantId) };
  }

  // The QA it was returned to (or a PM, e.g. to undo a mistaken return)
  // sends it back to Development.
  async sendBack(taskId: number, dto: ReturnToQaSendBackDto, currentUser: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    this.tasksService.assertNotJunk(task);
    if (task.status !== RETURNED_TO_QA_STATUS) {
      throw new BadRequestException(`#${taskId} is not with QA (it is ${task.status}) - reload to see it.`);
    }
    const current = await this.currentReturn(taskId, tenantId);
    const isPm = currentUser.role === UserRole.PROGRAM_MANAGER;
    if (!isPm && current?.qaUserId !== currentUser.id) {
      throw new ForbiddenException(`#${taskId} was sent back to ${current?.qaEmail || 'another QA'} - only they or a Program Manager can return it to the developer.`);
    }
    const note = (dto.note || '').trim() || null;
    const now = new Date();
    const waited = current ? businessDaysBetween(current.returnedAt, now) : 0;

    await this.dataSource.transaction(async (em) => {
      const updated = await em.update(
        ProjectTask,
        { id: taskId, tenantId, status: RETURNED_TO_QA_STATUS },
        { status: 'Development', pmWaitWorkingDays: (task.pmWaitWorkingDays || 0) + waited },
      );
      if (!updated.affected) {
        throw new BadRequestException(`#${taskId} changed while you were on it - reload and try again.`);
      }
      await this.auditLogService.recordWithin(em, {
        ...this.auditActor(currentUser, tenantId, taskId),
        action: RETURN_TO_QA_AUDIT.SENT_BACK,
        details: {
          note,
          statusFrom: RETURNED_TO_QA_STATUS,
          statusTo: 'Development',
          returnedToQaUserId: current?.qaUserId ?? null,
          waitedWorkingDays: waited,
        },
      });
    });

    const event: TaskReturnToQaSentBackEvent = {
      tenantId,
      taskId,
      title: task.title,
      assigneeUserId: task.assigneeUserId ?? null,
      pmUserId: current?.returnedByUserId ?? currentUser.id,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email,
      note,
    };
    this.eventEmitter.emit('task.returnToQaSentBack', event);
    return { task: await this.tasksService.findOne(taskId, tenantId) };
  }

  // Evidence and screenshots on a defect can be changed only by the QA it
  // was returned to, and only while it is Returned to QA.
  async assertCanEditEvidence(task: ProjectTask, currentUser: { id: number }): Promise<void> {
    if (!task.isDefect) throw new BadRequestException(`#${task.id} is not a defect - it has no defect evidence.`);
    if (task.status !== RETURNED_TO_QA_STATUS) {
      throw new BadRequestException(`#${task.id} is ${task.status} - evidence can only be changed while a PM has returned it to QA.`);
    }
    const current = await this.currentReturn(task.id, task.tenantId);
    if (current?.qaUserId !== currentUser.id) {
      throw new ForbiddenException(`Only the QA this defect was returned to can change its evidence.`);
    }
  }

  async addEvidence(taskId: number, dto: AddDefectEvidenceDto, currentUser: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    await this.assertCanEditEvidence(task, currentUser);
    const existing = await this.defectArtifactsRepository.find({ where: { taskId } });
    if (existing.some((a) => a.type === dto.type)) {
      throw new BadRequestException(`This defect already has a "${dto.type}" - remove it first to replace it.`);
    }
    await this.dataSource.transaction(async (em) => {
      const saved = await em.save(em.create(TaskDefectArtifact, { taskId, type: dto.type, url: dto.url }));
      await this.auditLogService.recordWithin(em, {
        ...this.auditActor(currentUser, tenantId, taskId),
        action: RETURN_TO_QA_AUDIT.EVIDENCE_ADDED,
        details: { artifactId: saved.id, type: dto.type, url: dto.url },
      });
    });
    return this.defectArtifactsRepository.find({ where: { taskId }, order: { id: 'ASC' } });
  }

  async removeEvidence(taskId: number, artifactId: number, currentUser: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    await this.assertCanEditEvidence(task, currentUser);
    const artifact = await this.defectArtifactsRepository.findOne({ where: { id: artifactId, taskId } });
    if (!artifact) throw new NotFoundException('That evidence is no longer on this defect - reload to see it.');
    await this.dataSource.transaction(async (em) => {
      await em.delete(TaskDefectArtifact, { id: artifact.id, taskId });
      // The link is kept here, so a removal can always be undone by hand.
      await this.auditLogService.recordWithin(em, {
        ...this.auditActor(currentUser, tenantId, taskId),
        action: RETURN_TO_QA_AUDIT.EVIDENCE_REMOVED,
        details: { artifactId: artifact.id, type: artifact.type, url: artifact.url },
      });
    });
    return this.defectArtifactsRepository.find({ where: { taskId }, order: { id: 'ASC' } });
  }

  // QA's "Returned to QA" list: tickets currently returned to this user.
  async listForQa(currentUser: User, tenantId: number) {
    const tasks = await this.dataSource.getRepository(ProjectTask).find({
      where: { tenantId, status: RETURNED_TO_QA_STATUS },
      order: { id: 'DESC' },
    });
    const mine: Array<Record<string, unknown>> = [];
    for (const t of tasks) {
      const current = await this.currentReturn(t.id, tenantId);
      if (current?.qaUserId !== currentUser.id) continue;
      mine.push({
        id: t.id,
        title: t.title,
        isDefect: t.isDefect,
        projectName: t.projectName,
        moduleName: t.moduleName,
        assigneeEmail: t.assigneeEmail,
        reason: current.reason,
        returnedByEmail: current.returnedByEmail,
        returnedAt: current.returnedAt,
      });
    }
    return mine;
  }

  private async viewable(taskId: number, currentUser: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (task.status === JUNK_STATUS && !this.tasksService.canSeeJunk(currentUser)) throw new NotFoundException('Not found');
    if (!(await this.tasksService.canView(task, currentUser))) throw new ForbiddenException('You do not have access to this task.');
    return task;
  }

  private auditActor(user: Actor, tenantId: number, taskId: number) {
    return { userId: user.id, userEmail: user.email, userRole: user.role, tenantId, entityType: 'ProjectTask', entityId: taskId };
  }
}
