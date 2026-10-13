import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, LessThan, Not, Repository } from 'typeorm';
import { TaskQaReview } from './task-qa-review.entity';
import { TaskQaReviewArtifact } from './task-qa-review-artifact.entity';
import { TaskQaReviewQaArtifact } from './task-qa-review-qa-artifact.entity';
import { QaSubmitTaskDto } from './dto/qa-submit-task.dto';
import { QaApproveTaskDto } from './dto/qa-approve-task.dto';
import { QaRejectTaskDto } from './dto/qa-reject-task.dto';
import { QaEscalateTaskDto } from './dto/qa-escalate-task.dto';
import { QaRevertDecisionDto } from './dto/qa-revert-decision.dto';
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
  revertedByFullName: string | null;
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
      if (review.revertedByUserId) userIds.add(review.revertedByUserId);
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
      revertedByFullName: review.revertedByUserId ? nameByUserId.get(review.revertedByUserId) || null : null,
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
    this.tasksService.assertNotJunk(task);
    if (task.assigneeUserId !== currentUser.id) {
      throw new ForbiddenException('Only the task Assignee can submit it for QA testing.');
    }
    // The UI only offers the Peer Review form for these, but the endpoint
    // never checked - so a QA-assigned task (always Peer Review, see
    // requiresPeerReviewForAssignee()) could be sent here directly and
    // reviewed by QA itself. A defect always goes to QA, whatever the flag.
    if (task.peerReviewEnabled && !task.isDefect) {
      throw new BadRequestException('Peer Review is enabled for this task - submit it for Peer Review instead of QA.');
    }
    this.tasksService.assertSubmittable(task);
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
    await this.tasksService.assertNotAlreadyApproved(task, tenantId);

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
    // A pending Peer Review round belongs to its picked reviewer only
    // (PeerReviewsService) - QA can't approve, reject or escalate it.
    // Before 2026-10-12 this returned any pending round, so a QA user
    // could decide a peer round from the task page.
    if (pending.reviewType !== 'qa') {
      throw new ForbiddenException('This task is in Peer Review - only its assigned Peer Reviewer can decide it, not QA.');
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
    this.tasksService.assertNotJunk(task);
    this.tasksService.assertReviewDecidable(task);
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

    this.eventEmitter.emit('task.reviewDecided', {
      tenantId,
      taskId,
      title: task.title,
      assigneeUserId: task.assigneeUserId,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email,
      decision: 'approved',
      reviewType: 'qa',
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
    this.tasksService.assertNotJunk(task);
    this.tasksService.assertReviewDecidable(task);
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

    this.eventEmitter.emit('task.reviewDecided', {
      tenantId,
      taskId,
      title: task.title,
      assigneeUserId: task.assigneeUserId,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email,
      decision: 'rejected',
      reviewType: 'qa',
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
    this.tasksService.assertNotJunk(task);
    this.tasksService.assertReviewDecidable(task);
    if (task.isDefect && task.createdByUserId !== currentUser.id) {
      throw new ForbiddenException('Only the QA who raised this defect can escalate it.');
    }
    // findPendingRound() refuses a Peer Review round.
    const pending = await this.findPendingRound(taskId, tenantId);

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

  // Program Manager / Admin undoes a QA approve or reject made by mistake
  // (2026-10-13, confirmed with the user; role gate in the controller).
  // Only the latest round, only a QA round, and only while the task is
  // still exactly where that decision left it - once the developer has
  // resubmitted or the task has moved on there is nothing to undo.
  //
  // The decided round is kept as history and marked 'reverted' (who, when,
  // why), and a fresh pending round re-opens the same submission - same
  // resolution, artifacts, submitter and submit time - so the task is back
  // in the QA queue as if the decision never happened. Every count keys
  // off 'approved'/'rejected', so the reverted decision stops counting
  // (KPI, QA Summary, rejection rate). Defects created by a reverted
  // rejection are junked, not unlinked: Junk takes them out of every list
  // and count and keeps them restorable, while an unlinked defect would
  // stay live and assigned. A reverted round can't be reverted again.
  async revertDecision(
    taskId: number,
    dto: QaRevertDecisionDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<{ task: ProjectTask; revertedRound: TaskQaReview; newRound: TaskQaReview; junkedDefectIds: number[] }> {
    const reason = (dto.reason || '').trim();
    const task = await this.tasksService.findOne(taskId, tenantId);
    this.tasksService.assertNotJunk(task);

    const latest = await this.qaReviewsRepository.findOne({ where: { taskId, tenantId }, order: { roundNumber: 'DESC', id: 'DESC' } });
    if (!latest) {
      throw new BadRequestException(`Task #${taskId} has no QA decision to revert.`);
    }
    if (latest.status === 'pending') {
      throw new BadRequestException(`Task #${taskId} is waiting for review (round ${latest.roundNumber}) - there is no decision to revert.`);
    }
    if (latest.status === 'reverted') {
      throw new BadRequestException(`The latest decision on task #${taskId} was already reverted.`);
    }
    if (latest.reviewType !== 'qa') {
      throw new BadRequestException(`The latest decision on task #${taskId} was a Peer Review - only a QA decision can be reverted.`);
    }
    if (latest.status === 'escalated') {
      throw new BadRequestException(`Task #${taskId} was escalated to PM, not approved or rejected - handle it from Interventions.`);
    }
    const decision = latest.status;
    const leftAt = decision === 'approved' ? 'Pass' : 'Failed';
    if (task.status !== leftAt) {
      throw new BadRequestException(
        `Task #${taskId} has moved on since QA ${decision === 'approved' ? 'approved' : 'rejected'} it (it is now ${task.status}) - the decision can no longer be reverted.`,
      );
    }
    if (decision === 'approved') {
      const [{ n }] = await this.qaReviewsRepository.query(`SELECT count(*)::int AS n FROM release_items WHERE "tenantId" = $1 AND "taskId" = $2`, [tenantId, taskId]);
      if (n > 0) {
        throw new BadRequestException(`Task #${taskId} is already in a release log - remove it from the release before reverting the approval.`);
      }
    }

    // Defects this rejection created, from its own audit entry - the only
    // record that ties a linked defect to one specific round.
    let defectIds: number[] = [];
    if (decision === 'rejected') {
      const entries: Array<{ details: string | null }> = await this.qaReviewsRepository.query(
        `SELECT details FROM audit_logs WHERE "tenantId" = $1 AND action = $2 AND "entityType" = 'ProjectTask' AND "entityId" = $3 ORDER BY id DESC`,
        [tenantId, AuditActions.TASK_QA_REJECTED, taskId],
      );
      for (const e of entries) {
        let details: any = null;
        try {
          details = e.details ? JSON.parse(e.details) : null;
        } catch {
          details = null;
        }
        if (details?.roundNumber === latest.roundNumber) {
          defectIds = Array.isArray(details.linkedDefectIds) ? details.linkedDefectIds : [];
          break;
        }
      }
    }
    const defects = defectIds.length > 0 ? await this.tasksRepository.find({ where: { tenantId, id: In(defectIds) } }) : [];
    const liveDefects = defects.filter((d) => d.status !== 'Junk');
    if (liveDefects.length > 0) {
      const started = await this.qaReviewsRepository.find({ where: { tenantId, taskId: In(liveDefects.map((d) => d.id)) } });
      const moved = liveDefects.filter((d) => d.status !== 'Development' || started.some((r) => r.taskId === d.id));
      if (moved.length > 0) {
        throw new BadRequestException(
          `Defect ${moved.map((d) => `#${d.id}`).join(', ')} raised from this rejection is already being worked on - the rejection can no longer be reverted.`,
        );
      }
    }

    // Feedback if no earlier round still stands as a decision, else
    // Re-Feedback - the same first-time/resubmission split submit() makes.
    const earlierDecided = await this.qaReviewsRepository.count({
      where: { taskId, tenantId, roundNumber: LessThan(latest.roundNumber), status: Not(In(['pending', 'reverted'])) },
    });
    const newStatus = earlierDecided === 0 ? 'Feedback' : 'Re-Feedback';
    const now = new Date();

    const result = await this.qaReviewsRepository.manager.transaction(async (em) => {
      // Guarded updates: two PMs reverting at once, or QA/the developer
      // acting in the meantime, can't both succeed.
      const roundUpdate = await em.update(
        TaskQaReview,
        { id: latest.id, tenantId, status: decision },
        { status: 'reverted', revertedByUserId: currentUser.id, revertedAt: now, revertReason: reason, revertedDecision: decision },
      );
      if (!roundUpdate.affected) {
        throw new BadRequestException(`The latest decision on task #${taskId} changed while you were reverting it - reload and try again.`);
      }
      const taskUpdate = await em.update(
        ProjectTask,
        { id: taskId, tenantId, status: leftAt },
        decision === 'approved' ? { status: newStatus, completedAt: null } : { status: newStatus },
      );
      if (!taskUpdate.affected) {
        throw new BadRequestException(`Task #${taskId} changed while you were reverting it - reload and try again.`);
      }
      const roundCount = await em.count(TaskQaReview, { where: { taskId, tenantId } });
      const newRound = await em.save(
        TaskQaReview,
        em.create(TaskQaReview, {
          tenantId,
          taskId,
          roundNumber: roundCount + 1,
          resolution: latest.resolution,
          submittedByUserId: latest.submittedByUserId,
          submittedByEmail: latest.submittedByEmail,
          status: 'pending',
          reviewType: 'qa',
          noteQualityFlagged: latest.noteQualityFlagged,
          noteQualityReason: latest.noteQualityReason,
        }),
      );
      // Same submission, so the same submit time (the QA review SLA and
      // the Waiting list's "Submitted" keep their real date).
      await em.update(TaskQaReview, { id: newRound.id }, { submittedAt: latest.submittedAt });
      newRound.submittedAt = latest.submittedAt;
      const submitted = await em.find(TaskQaReviewArtifact, { where: { taskQaReviewId: latest.id } });
      if (submitted.length > 0) {
        await em.save(
          TaskQaReviewArtifact,
          submitted.map((a) => em.create(TaskQaReviewArtifact, { taskQaReviewId: newRound.id, type: a.type, url: a.url })),
        );
      }

      let junked: ProjectTask[] = [];
      if (liveDefects.length > 0) {
        const locked = await em.getRepository(ProjectTask).find({
          where: { tenantId, id: In(liveDefects.map((d) => d.id)), status: 'Development' },
          lock: { mode: 'pessimistic_write' },
        });
        if (locked.length !== liveDefects.length) {
          throw new BadRequestException('A defect raised from this rejection changed while you were reverting it - reload and try again.');
        }
        junked = await this.tasksService.junkWithin(em, locked, `QA rejection of task #${taskId} reverted: ${reason}`, currentUser, tenantId, 'qa-revert');
      }

      await this.auditLogService.recordWithin(em, {
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        action: AuditActions.TASK_QA_DECISION_REVERTED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: taskId,
        details: {
          reason,
          roundNumber: latest.roundNumber,
          revertedDecision: decision,
          decidedByUserId: latest.reviewedByUserId,
          decidedAt: latest.reviewedAt,
          qaComment: latest.qaComment,
          statusFrom: leftAt,
          statusTo: newStatus,
          newRoundNumber: newRound.roundNumber,
          junkedDefectIds: junked.map((d) => d.id),
        },
      });
      return { newRound, junkedDefectIds: junked.map((d) => d.id) };
    });

    const revertedRound = await this.qaReviewsRepository.findOneOrFail({ where: { id: latest.id } });
    const savedTask = await this.tasksService.findOne(taskId, tenantId);
    this.eventEmitter.emit('task.qaDecisionReverted', {
      tenantId,
      taskId,
      title: task.title,
      assigneeUserId: task.assigneeUserId,
      qaUserId: latest.reviewedByUserId,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email,
      decision,
    });
    return { task: savedTask, revertedRound, newRound: result.newRound, junkedDefectIds: result.junkedDefectIds };
  }
}
