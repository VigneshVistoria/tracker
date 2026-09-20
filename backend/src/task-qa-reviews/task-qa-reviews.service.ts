import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, Repository } from 'typeorm';
import { TaskQaReview } from './task-qa-review.entity';
import { TaskQaReviewArtifact } from './task-qa-review-artifact.entity';
import { TaskQaReviewQaArtifact } from './task-qa-review-qa-artifact.entity';
import { QaSubmitTaskDto } from './dto/qa-submit-task.dto';
import { QaApproveTaskDto } from './dto/qa-approve-task.dto';
import { QaRejectTaskDto } from './dto/qa-reject-task.dto';
import { QaEscalateTaskDto } from './dto/qa-escalate-task.dto';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { sanitizeRichText } from '../common/sanitize-rich-text';
import { NoteQualityService } from '../note-quality/note-quality.service';

export type TaskQaReviewWithArtifacts = TaskQaReview & { artifacts: TaskQaReviewArtifact[] };
export type TaskQaReviewWithQaArtifacts = TaskQaReview & { qaArtifacts: TaskQaReviewQaArtifact[] };

// findForTask's display-oriented shape - adds the submitting/reviewing
// user's current fullName, resolved via a batch lookup rather than
// stored on the row (see findForTask below), and QA's own evidence
// artifacts (attached at approve/reject time, separate from the
// Assignee's submission-time `artifacts`).
export type TaskQaReviewForDisplay = TaskQaReviewWithArtifacts & {
  submittedByFullName: string;
  reviewedByFullName: string | null;
  qaArtifacts: TaskQaReviewQaArtifact[];
};

@Injectable()
export class TaskQaReviewsService {
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
    private eventEmitter: EventEmitter2,
    private noteQualityService: NoteQualityService,
  ) {}

  // Combined task detail view - every past QA review round for a task,
  // most recent first, so a rejection's comment stays visible even after
  // a later round supersedes it. Each round's artifacts are fetched in one
  // extra query and grouped back onto their round, rather than N+1
  // queries per round. The submitting/reviewing user's fullName is
  // resolved the same way (one batch lookup, not per-row) rather than
  // being stored on the row - so it always reflects the user's current
  // name, and old rows don't need a backfill.
  async findForTask(taskId: number, tenantId: number): Promise<TaskQaReviewForDisplay[]> {
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

    const qaArtifacts = await this.qaArtifactsRepository.find({
      where: { taskQaReviewId: In(reviews.map((r) => r.id)) },
    });
    const qaArtifactsByReview = new Map<number, TaskQaReviewQaArtifact[]>();
    for (const artifact of qaArtifacts) {
      const group = qaArtifactsByReview.get(artifact.taskQaReviewId) || [];
      group.push(artifact);
      qaArtifactsByReview.set(artifact.taskQaReviewId, group);
    }

    const userIds = new Set<number>();
    for (const review of reviews) {
      userIds.add(review.submittedByUserId);
      if (review.reviewedByUserId) userIds.add(review.reviewedByUserId);
    }
    const users = await this.usersService.findByIds([...userIds], tenantId);
    const nameByUserId = new Map(users.map((u) => [u.id, u.fullName || u.email]));

    return reviews.map((review) => ({
      ...review,
      artifacts: byReview.get(review.id) || [],
      qaArtifacts: qaArtifactsByReview.get(review.id) || [],
      submittedByFullName: nameByUserId.get(review.submittedByUserId) || review.submittedByEmail,
      reviewedByFullName: review.reviewedByUserId
        ? nameByUserId.get(review.reviewedByUserId) || review.reviewedByEmail
        : null,
    }));
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
    // An escalated task has no 'pending' round (the escalate() round is
    // terminal, status 'escalated') but must still block resubmission
    // until PM reassigns it - otherwise the Assignee could resubmit
    // straight past the PM Escalation queue entirely.
    if (task.status === 'Escalated') {
      throw new BadRequestException('This task is escalated to PM and cannot be resubmitted until PM reassigns it.');
    }
    this.tasksService.assertReadyForQaSubmission(task.estimatedHours, task.dueDate);
    // QA-only hard block, no role exception - see the method's own comment.
    // Deliberately not called from PeerReviewsService.submit(). Coexists
    // with the open-Dependency-Ticket check above - either one
    // independently blocks resubmission.
    await this.tasksService.assertNoOpenDependencyTickets(taskId, tenantId);
    await this.tasksService.assertNoOpenLinkedDefects(taskId, tenantId);

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
        resolution: sanitizeRichText(dto.resolution),
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
    // Reset fresh on every submission (first or a resubmission alike) -
    // never tied back to an earlier round's date.
    task.qaReviewDueDate = this.tasksService.computeQaReviewDueDate(new Date());
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

    // Fire-and-forget - never awaited, so a slow/failed/rate-limited
    // Gemini call can't add latency to or fail this submission. See
    // NoteQualityService.
    this.noteQualityService.queueCheck(savedReview.id, task.title, savedReview.resolution);

    return { ...savedReview, artifacts: savedArtifacts };
  }

  private async findPendingRound(taskId: number, tenantId: number): Promise<TaskQaReview> {
    const pending = await this.qaReviewsRepository.findOne({ where: { taskId, tenantId, status: 'pending' } });
    if (!pending) {
      throw new BadRequestException('There is no QA review round pending for this task.');
    }
    return pending;
  }

  // Stage 5a: QA approves the pending round. Any QA-side evidence
  // artifacts are optional (unlike the Assignee's mandatory submission
  // artifacts) but, when present, are saved alongside the review-status
  // update in one transaction - same reasoning as submit() - so a round
  // can never end up "approved" with only some of its evidence rows
  // landed.
  async approve(
    taskId: number,
    dto: QaApproveTaskDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskQaReviewWithQaArtifacts> {
    if (currentUser.role !== UserRole.QA) {
      throw new ForbiddenException('Only QA can approve a task under review.');
    }
    const task = await this.tasksService.findOne(taskId, tenantId);
    // A defect round routes back to the specific QA who raised it
    // (task.createdByUserId), not the shared QA queue - any other QA
    // hitting this endpoint on a defect task is blocked, same as a Peer
    // Review round is locked to its picked reviewer.
    if (task.isDefect && task.createdByUserId !== currentUser.id) {
      throw new ForbiddenException('Only the QA who raised this defect can approve it.');
    }
    const pending = await this.findPendingRound(taskId, tenantId);

    pending.status = 'approved';
    // Optional, unlike reject's required comment - only set qaComment if
    // QA actually left one, same column reject/escalate write to.
    if (dto.comment) {
      pending.qaComment = sanitizeRichText(dto.comment);
    }
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
      action: AuditActions.TASK_QA_APPROVED,
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

  // Stage 5b/6: QA rejects the pending round with a required comment -
  // task returns to the Assignee's own action queue (Failed), not PM's
  // Task Backlog. The Assignee resubmits via submit() above, which opens
  // a new round (status 'Re-Feedback') rather than touching this
  // rejected one. Optionally also files one or more linked Defects
  // (dto.linkedDefects) for issues serious enough to need their own
  // tracked ticket(s) - see TasksService.createDefect()'s parentTaskId
  // param and assertNoOpenLinkedDefects(), which then blocks this task's
  // own resubmission until every one of those defects resolves. A plain
  // reject with just a comment (no linkedDefects) is unaffected either
  // way.
  async reject(
    taskId: number,
    dto: QaRejectTaskDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskQaReviewWithQaArtifacts & { linkedDefects: ProjectTask[] }> {
    if (currentUser.role !== UserRole.QA) {
      throw new ForbiddenException('Only QA can reject a task under review.');
    }
    const task = await this.tasksService.findOne(taskId, tenantId);
    // Same defect-routing lock as approve() above.
    if (task.isDefect && task.createdByUserId !== currentUser.id) {
      throw new ForbiddenException('Only the QA who raised this defect can reject it.');
    }
    const pending = await this.findPendingRound(taskId, tenantId);

    pending.status = 'rejected';
    pending.qaComment = sanitizeRichText(dto.comment);
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

    // "Create linked defect(s)" is a straightforward reuse of
    // TasksService.createDefect() - same validation (assignee must be
    // Developer/Designer/DevOps), same Project/Module/Phase resolution,
    // just with parentTaskId set and Project/Module/Phase copied from the
    // task being rejected instead of picked again. One call per batch
    // entry, each one getting a copy of the same shared
    // dto.linkedDefectArtifacts - there's no schema concept of many
    // defects referencing one shared artifact row, so "shared" here means
    // "copied into every defect's own artifact rows", not a single row
    // referenced N times.
    const linkedDefects: ProjectTask[] = [];
    for (const linkedDefect of dto.linkedDefects || []) {
      const created = await this.tasksService.createDefect(
        {
          projectId: task.projectId,
          moduleId: task.moduleId,
          phaseId: task.phaseId,
          title: linkedDefect.title,
          description: linkedDefect.description,
          assigneeUserId: linkedDefect.assigneeUserId,
          artifacts: dto.linkedDefectArtifacts,
        },
        currentUser,
        tenantId,
        taskId,
      );
      linkedDefects.push(created);
    }

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_QA_REJECTED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: {
        roundNumber: savedReview.roundNumber,
        comment: dto.comment,
        artifactTypes: (dto.artifacts || []).map((a) => a.type),
        linkedDefectIds: linkedDefects.map((d) => d.id),
      },
    });

    return { ...savedReview, qaArtifacts: savedQaArtifacts, linkedDefects };
  }

  // QA Feedback escalation to PM - an alternative to Approve/Reject for
  // when the resolution is unclear or looks unrelated to the actual task,
  // not a straightforward pass/fail call. Ends the pending round the same
  // way reject() does (status/reviewedBy/reviewedAt), just with a
  // different terminal value ('escalated', not 'rejected') so it never
  // touches KpiService's rejection-count query - escalating isn't itself
  // a rejection. QA Feedback only: blocked for a 'peer' round (Peer
  // Review has its own separate approve/reject endpoints and was never
  // meant to reach PM this way) and, like approve()/reject(), blocked for
  // any QA other than the one who raised a defect ticket.
  async escalate(
    taskId: number,
    dto: QaEscalateTaskDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskQaReview> {
    if (currentUser.role !== UserRole.QA) {
      throw new ForbiddenException('Only QA can escalate a task under review.');
    }
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (task.isDefect && task.createdByUserId !== currentUser.id) {
      throw new ForbiddenException('Only the QA who raised this defect can escalate it.');
    }
    const pending = await this.findPendingRound(taskId, tenantId);
    if (pending.reviewType !== 'qa') {
      throw new BadRequestException('Only a QA Feedback round can be escalated to PM - not Peer Review.');
    }

    pending.status = 'escalated';
    pending.qaComment = sanitizeRichText(dto.comment);
    pending.reviewedByUserId = currentUser.id;
    pending.reviewedByEmail = currentUser.email;
    pending.reviewedAt = new Date();
    const savedReview = await this.qaReviewsRepository.save(pending);

    task.status = 'Escalated';
    const savedTask = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_QA_ESCALATED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: { roundNumber: savedReview.roundNumber, comment: dto.comment },
    });

    this.eventEmitter.emit('task.escalatedToPm', {
      task: savedTask,
      escalatedByEmail: currentUser.email,
      comment: dto.comment,
    });

    return savedReview;
  }
}
