import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TaskQaReview } from './task-qa-review.entity';
import { TaskQaReviewArtifact } from './task-qa-review-artifact.entity';
import { QaSubmitTaskDto } from './dto/qa-submit-task.dto';
import { QaRejectTaskDto } from './dto/qa-reject-task.dto';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserRole } from '../users/user.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export type TaskQaReviewWithArtifacts = TaskQaReview & { artifacts: TaskQaReviewArtifact[] };

@Injectable()
export class TaskQaReviewsService {
  constructor(
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    @InjectRepository(TaskQaReviewArtifact)
    private artifactsRepository: Repository<TaskQaReviewArtifact>,
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    private tasksService: TasksService,
    private auditLogService: AuditLogService,
  ) {}

  // Combined task detail view - every past QA review round for a task,
  // most recent first, so a rejection's comment stays visible even after
  // a later round supersedes it. Each round's artifacts are fetched in one
  // extra query and grouped back onto their round, rather than N+1
  // queries per round.
  async findForTask(taskId: number, tenantId: number): Promise<TaskQaReviewWithArtifacts[]> {
    const reviews = await this.qaReviewsRepository.find({
      where: { taskId, tenantId },
      order: { roundNumber: 'DESC' },
    });
    if (reviews.length === 0) return [];

    const artifacts = await this.artifactsRepository.find({
      where: { taskQaReviewId: In(reviews.map((r) => r.id)) },
    });
    const byReview = new Map<number, TaskQaReviewArtifact[]>();
    for (const artifact of artifacts) {
      const group = byReview.get(artifact.taskQaReviewId) || [];
      group.push(artifact);
      byReview.set(artifact.taskQaReviewId, group);
    }

    return reviews.map((review) => ({ ...review, artifacts: byReview.get(review.id) || [] }));
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
  ): Promise<TaskQaReviewWithArtifacts> {
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

    // Review row + its artifact rows are saved together in a transaction
    // so a submission can never land with a round but no artifacts (or
    // vice versa) - same reasoning as Evidence's createBatch.
    const { savedReview, savedArtifacts } = await this.qaReviewsRepository.manager.transaction(async (manager) => {
      const review = manager.create(TaskQaReview, {
        tenantId,
        taskId,
        roundNumber: priorRounds + 1,
        resolution: dto.resolution,
        submittedByUserId: currentUser.id,
        submittedByEmail: currentUser.email,
        status: 'pending',
      });
      const savedReview = await manager.save(TaskQaReview, review);

      const artifacts = dto.artifacts.map((item) =>
        manager.create(TaskQaReviewArtifact, {
          taskQaReviewId: savedReview.id,
          type: item.type,
          url: item.url,
        }),
      );
      const savedArtifacts = await manager.save(TaskQaReviewArtifact, artifacts);

      return { savedReview, savedArtifacts };
    });

    task.status = priorRounds === 0 ? 'Feedback' : 'Re-Feedback';
    task.actualHours = dto.actualHours;
    await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_QA_SUBMITTED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: { roundNumber: savedReview.roundNumber, artifactTypes: dto.artifacts.map((a) => a.type) },
    });

    return { ...savedReview, artifacts: savedArtifacts };
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
    task.completedAt = new Date();
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
