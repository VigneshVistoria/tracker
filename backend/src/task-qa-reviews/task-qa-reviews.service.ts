import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskQaReview } from './task-qa-review.entity';
import { QaSubmitTaskDto } from './dto/qa-submit-task.dto';
import { QaRejectTaskDto } from './dto/qa-reject-task.dto';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserRole } from '../users/user.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

@Injectable()
export class TaskQaReviewsService {
  constructor(
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    private tasksService: TasksService,
    private auditLogService: AuditLogService,
  ) {}

  // Combined task detail view - every past QA review round for a task,
  // most recent first, so a rejection's comment stays visible even after
  // a later round supersedes it.
  findForTask(taskId: number, tenantId: number): Promise<TaskQaReview[]> {
    return this.qaReviewsRepository.find({
      where: { taskId, tenantId },
      order: { roundNumber: 'DESC' },
    });
  }

  // Stage 4: Assignee submits the task for QA testing - creates a new
  // review round (never overwrites a prior one, so rejection history is
  // never lost) and moves the task's status into the QA queue. First-ever
  // submission auto-sets Status to 'Feedback'; any resubmission after a
  // prior round (i.e. after a QA rejection) auto-sets it to 'Re-Feedback'
  // instead, so the Tasks list can tell a first pass apart from a redo at
  // a glance.
  async submit(
    taskId: number,
    dto: QaSubmitTaskDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskQaReview> {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (task.assigneeUserId !== currentUser.id) {
      throw new ForbiddenException('Only the task Assignee can submit it for QA testing.');
    }
    this.tasksService.assertReadyForQaSubmission(task.estimatedHours, task.dueDate);

    const existingPending = await this.qaReviewsRepository.findOne({ where: { taskId, tenantId, status: 'pending' } });
    if (existingPending) {
      throw new BadRequestException('This task already has a QA review round pending - it cannot be resubmitted until QA acts on it.');
    }

    const priorRounds = await this.qaReviewsRepository.count({ where: { taskId, tenantId } });

    const review = this.qaReviewsRepository.create({
      tenantId,
      taskId,
      roundNumber: priorRounds + 1,
      resolution: dto.resolution,
      artifactType: dto.artifactType,
      artifactUrl: dto.artifactUrl,
      submittedByUserId: currentUser.id,
      submittedByEmail: currentUser.email,
      status: 'pending',
    });
    const savedReview = await this.qaReviewsRepository.save(review);

    task.status = priorRounds === 0 ? 'Feedback' : 'Re-Feedback';
    await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_QA_SUBMITTED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: { roundNumber: savedReview.roundNumber },
    });

    return savedReview;
  }

  private async findPendingRound(taskId: number, tenantId: number): Promise<TaskQaReview> {
    const pending = await this.qaReviewsRepository.findOne({ where: { taskId, tenantId, status: 'pending' } });
    if (!pending) {
      throw new BadRequestException('There is no QA review round pending for this task.');
    }
    return pending;
  }

  // Stage 5a: QA approves the pending round.
  async approve(
    taskId: number,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskQaReview> {
    if (currentUser.role !== UserRole.QA) {
      throw new ForbiddenException('Only QA can approve a task under review.');
    }
    const task = await this.tasksService.findOne(taskId, tenantId);
    const pending = await this.findPendingRound(taskId, tenantId);

    pending.status = 'approved';
    pending.reviewedByUserId = currentUser.id;
    pending.reviewedByEmail = currentUser.email;
    pending.reviewedAt = new Date();
    const savedReview = await this.qaReviewsRepository.save(pending);

    task.status = 'Pass';
    await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_QA_APPROVED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: { roundNumber: savedReview.roundNumber },
    });

    return savedReview;
  }

  // Stage 5b/6: QA rejects the pending round with a required comment -
  // task returns to the Assignee's own action queue (Failed), not PM's
  // Task Backlog. The Assignee resubmits via submit() above, which opens
  // a new round (status 'Re-Feedback') rather than touching this
  // rejected one.
  async reject(
    taskId: number,
    dto: QaRejectTaskDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskQaReview> {
    if (currentUser.role !== UserRole.QA) {
      throw new ForbiddenException('Only QA can reject a task under review.');
    }
    const task = await this.tasksService.findOne(taskId, tenantId);
    const pending = await this.findPendingRound(taskId, tenantId);

    pending.status = 'rejected';
    pending.qaComment = dto.comment;
    pending.reviewedByUserId = currentUser.id;
    pending.reviewedByEmail = currentUser.email;
    pending.reviewedAt = new Date();
    const savedReview = await this.qaReviewsRepository.save(pending);

    task.status = 'Failed';
    await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_QA_REJECTED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: { roundNumber: savedReview.roundNumber, comment: dto.comment },
    });

    return savedReview;
  }
}
