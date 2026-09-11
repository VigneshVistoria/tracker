import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { TaskQaReviewArtifact } from '../task-qa-reviews/task-qa-review-artifact.entity';
import { TaskQaReviewQaArtifact } from '../task-qa-reviews/task-qa-review-qa-artifact.entity';
import { SubmitPeerReviewDto } from './dto/submit-peer-review.dto';
import { ApprovePeerReviewDto } from './dto/approve-peer-review.dto';
import { RejectPeerReviewDto } from './dto/reject-peer-review.dto';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export type PeerReviewWithArtifacts = TaskQaReview & { artifacts: TaskQaReviewArtifact[] };
export type PeerReviewWithQaArtifacts = TaskQaReview & { qaArtifacts: TaskQaReviewQaArtifact[] };

// Peer Review's equivalent of TaskQaReviewsService (task-qa-reviews/) -
// deliberately a separate service/module rather than added methods on
// that one, so the existing QA submit/approve/reject code paths are never
// touched by this feature. Both share the same task_qa_reviews table
// (reviewType: 'qa' vs 'peer') so the retest counter (roundNumber) and the
// KPI QA-rejection penalty (KpiService.computeMetrics, which queries this
// table with no reviewType filter) treat a peer rejection exactly like a
// QA one, automatically.
@Injectable()
export class PeerReviewsService {
  constructor(
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    @InjectRepository(TaskQaReviewArtifact)
    private artifactsRepository: Repository<TaskQaReviewArtifact>,
    @InjectRepository(TaskQaReviewQaArtifact)
    private qaArtifactsRepository: Repository<TaskQaReviewQaArtifact>,
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
  ) {}

  private async findPendingPeerRound(taskId: number, tenantId: number): Promise<TaskQaReview> {
    const pending = await this.qaReviewsRepository.findOne({ where: { taskId, tenantId, status: 'pending' } });
    if (!pending || pending.reviewType !== 'peer') {
      throw new BadRequestException('There is no Peer Review round pending for this task.');
    }
    return pending;
  }

  // Assignee submits the task for Peer Review instead of QA - only
  // reachable when the task's peerReviewEnabled is set (checked here too,
  // not just hidden in the UI, so the routing rule can't be bypassed by
  // calling this endpoint directly on a task that hasn't opted in).
  async submit(
    taskId: number,
    dto: SubmitPeerReviewDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<PeerReviewWithArtifacts> {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (task.assigneeUserId !== currentUser.id) {
      throw new ForbiddenException('Only the task Assignee can submit it for Peer Review.');
    }
    if (!task.peerReviewEnabled) {
      throw new BadRequestException('Peer Review is not enabled for this task.');
    }
    this.tasksService.assertReadyForQaSubmission(task.estimatedHours, task.dueDate);

    if (dto.reviewerUserId === currentUser.id) {
      throw new ForbiddenException('You cannot select yourself as the Peer Reviewer.');
    }
    const reviewer = await this.usersService.findByIdAndTenant(dto.reviewerUserId, tenantId);
    if (!reviewer || reviewer.role !== UserRole.DEVELOPER) {
      throw new BadRequestException('Peer Reviewer must be another Developer.');
    }

    const existingPending = await this.qaReviewsRepository.findOne({ where: { taskId, tenantId, status: 'pending' } });
    if (existingPending) {
      throw new BadRequestException('This task already has a review round pending - it cannot be resubmitted until that round is decided.');
    }

    const priorRounds = await this.qaReviewsRepository.count({ where: { taskId, tenantId } });

    const { savedReview, savedArtifacts } = await this.qaReviewsRepository.manager.transaction(async (manager) => {
      const review = manager.create(TaskQaReview, {
        tenantId,
        taskId,
        roundNumber: priorRounds + 1,
        resolution: dto.resolution,
        submittedByUserId: currentUser.id,
        submittedByEmail: currentUser.email,
        status: 'pending',
        reviewType: 'peer',
        reviewerUserId: reviewer.id,
        reviewerEmail: reviewer.email,
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

    task.status = priorRounds === 0 ? 'Peer Review' : 'Re-Peer-Review';
    task.actualHours = dto.actualHours;
    await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_PEER_REVIEW_SUBMITTED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: {
        roundNumber: savedReview.roundNumber,
        reviewerUserId: reviewer.id,
        reviewerEmail: reviewer.email,
        artifactTypes: dto.artifacts.map((a) => a.type),
      },
    });

    return { ...savedReview, artifacts: savedArtifacts };
  }

  // Reviewer approves - task is fully closed, same terminal outcome as a
  // QA approval (no QA step follows).
  async approve(
    taskId: number,
    dto: ApprovePeerReviewDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<PeerReviewWithQaArtifacts> {
    const task = await this.tasksService.findOne(taskId, tenantId);
    const pending = await this.findPendingPeerRound(taskId, tenantId);
    if (currentUser.id !== pending.reviewerUserId) {
      throw new ForbiddenException('Only the assigned Peer Reviewer can approve this task.');
    }

    pending.status = 'approved';
    pending.reviewedByUserId = currentUser.id;
    pending.reviewedByEmail = currentUser.email;
    pending.reviewedAt = new Date();

    const { savedReview, savedQaArtifacts } = await this.qaReviewsRepository.manager.transaction(async (manager) => {
      const savedReview = await manager.save(TaskQaReview, pending);

      const artifacts = (dto.artifacts || []).map((item) =>
        manager.create(TaskQaReviewQaArtifact, {
          taskQaReviewId: savedReview.id,
          type: item.type,
          url: item.url,
        }),
      );
      const savedQaArtifacts = await manager.save(TaskQaReviewQaArtifact, artifacts);

      return { savedReview, savedQaArtifacts };
    });

    task.status = 'Pass';
    task.completedAt = new Date();
    await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_PEER_REVIEW_APPROVED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: { roundNumber: savedReview.roundNumber, artifactTypes: (dto.artifacts || []).map((a) => a.type) },
    });

    return { ...savedReview, qaArtifacts: savedQaArtifacts };
  }

  // Reviewer rejects with a required comment - task returns to the
  // Assignee (status 'Failed'), same comment-history pattern as a QA
  // rejection (same table, same qaComment column), and counts toward the
  // same retest counter / KPI QA-rejection penalty as a QA rejection -
  // see the module-level comment above.
  async reject(
    taskId: number,
    dto: RejectPeerReviewDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<PeerReviewWithQaArtifacts> {
    const task = await this.tasksService.findOne(taskId, tenantId);
    const pending = await this.findPendingPeerRound(taskId, tenantId);
    if (currentUser.id !== pending.reviewerUserId) {
      throw new ForbiddenException('Only the assigned Peer Reviewer can reject this task.');
    }

    pending.status = 'rejected';
    pending.qaComment = dto.comment;
    pending.reviewedByUserId = currentUser.id;
    pending.reviewedByEmail = currentUser.email;
    pending.reviewedAt = new Date();

    const { savedReview, savedQaArtifacts } = await this.qaReviewsRepository.manager.transaction(async (manager) => {
      const savedReview = await manager.save(TaskQaReview, pending);

      const artifacts = (dto.artifacts || []).map((item) =>
        manager.create(TaskQaReviewQaArtifact, {
          taskQaReviewId: savedReview.id,
          type: item.type,
          url: item.url,
        }),
      );
      const savedQaArtifacts = await manager.save(TaskQaReviewQaArtifact, artifacts);

      return { savedReview, savedQaArtifacts };
    });

    task.status = 'Failed';
    await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_PEER_REVIEW_REJECTED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: {
        roundNumber: savedReview.roundNumber,
        comment: dto.comment,
        artifactTypes: (dto.artifacts || []).map((a) => a.type),
      },
    });

    return { ...savedReview, qaArtifacts: savedQaArtifacts };
  }
}
