import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityManager, In, Not, Repository } from 'typeorm';
import { NON_VERDICT_ROUND_STATUSES, TaskQaReview } from './task-qa-review.entity';
import { TaskQaReviewArtifact } from './task-qa-review-artifact.entity';
import { PmSendBackDto, PmSendToQaDto } from './dto/pm-review.dto';
import { ProjectTask } from '../tasks/project-task.entity';
import { Project } from '../projects/project.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { sanitizeRichText, richTextToPlainText } from '../common/sanitize-rich-text';
import { businessDaysBetween } from '../common/business-days';
import { PM_FEEDBACK_STATUS, PM_REVIEW_STATUS } from '../tasks/pm-review';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { PM_REMINDER_DEFAULT_DAYS } from './pm-review-reminder.service';

type Actor = { id: number; email: string; role: UserRole };

export interface PmReviewQueueItem {
  taskId: number;
  title: string;
  projectId: number;
  projectName: string;
  moduleName: string;
  priority: string | null;
  dueDate: string | null;
  assigneeUserId: number | null;
  assigneeName: string | null;
  submittedByName: string | null;
  submittedAt: Date;
  roundNumber: number;
  // This task's PM rounds so far (this one included) and how many of them
  // the PM sent back - tracked apart from QA's retest counter.
  pmRound: number;
  pmSendBacks: number;
  waitingWorkingDays: number;
}

// PM review gate (2026-10-13, confirmed with the user) - see
// backend/src/tasks/pm-review.ts for the statuses. A Program Manager or
// Admin (role gate in PmReviewsController) decides a pending 'pm' round:
//   sendToQa  - the round is approved and a fresh pending 'qa' round opens
//               with the same resolution and evidence, as if the developer
//               had just submitted (Feedback, or Re-Feedback after an
//               earlier QA round; QA review due date from now).
//   sendBack  - the round is rejected with a required comment; the task
//               goes to PM Feedback for the developer to refine and submit
//               again. Not a QA rejection - nothing QA-side counts it.
// Anyone with the role may act; the first one wins (guarded update). A PM
// may decide a task assigned to themselves - allowed, flagged in the audit.
// The working days the round waited are added to pmWaitWorkingDays so PM
// time never counts against the developer.
@Injectable()
export class PmReviewsService {
  constructor(
    @InjectRepository(TaskQaReview)
    private reviewsRepository: Repository<TaskQaReview>,
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(Project)
    private projectsRepository: Repository<Project>,
    @InjectRepository(TeamSettings)
    private teamSettingsRepository: Repository<TeamSettings>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
  ) {}

  async queue(tenantId: number): Promise<{ items: PmReviewQueueItem[]; statCounts: { pending: number } }> {
    const tasks = await this.tasksRepository.find({ where: { tenantId, status: PM_REVIEW_STATUS }, order: { updatedAt: 'ASC', id: 'ASC' } });
    if (tasks.length === 0) return { items: [], statCounts: { pending: 0 } };
    const pmRounds = await this.reviewsRepository.find({ where: { tenantId, taskId: In(tasks.map((t) => t.id)), reviewType: 'pm' } });
    const userIds = new Set<number>();
    for (const t of tasks) if (t.assigneeUserId) userIds.add(t.assigneeUserId);
    for (const r of pmRounds) userIds.add(r.submittedByUserId);
    const users = await this.usersService.findByIds([...userIds], tenantId);
    const nameOf = (id: number | null) => (id ? users.find((u) => u.id === id)?.fullName || users.find((u) => u.id === id)?.email || null : null);
    const now = new Date();
    const items: PmReviewQueueItem[] = [];
    for (const t of tasks) {
      const rounds = pmRounds.filter((r) => r.taskId === t.id);
      const pending = rounds.find((r) => r.status === 'pending');
      if (!pending) continue;
      items.push({
        taskId: t.id,
        title: t.title,
        projectId: t.projectId,
        projectName: t.projectName,
        moduleName: t.moduleName,
        priority: t.priority ?? null,
        dueDate: t.dueDate ?? null,
        assigneeUserId: t.assigneeUserId ?? null,
        assigneeName: nameOf(t.assigneeUserId),
        submittedByName: nameOf(pending.submittedByUserId),
        submittedAt: pending.submittedAt,
        roundNumber: pending.roundNumber,
        pmRound: rounds.length,
        pmSendBacks: rounds.filter((r) => r.status === 'rejected').length,
        waitingWorkingDays: businessDaysBetween(new Date(pending.submittedAt), now),
      });
    }
    // Longest waiting first.
    items.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime() || a.taskId - b.taskId);
    return { items, statCounts: { pending: items.length } };
  }

  async sendToQa(taskId: number, dto: PmSendToQaDto, actor: Actor, tenantId: number) {
    const { task, round } = await this.loadDecidable(taskId, tenantId);
    // Same blocks as a developer submit - a dependency ticket or linked
    // defect may have been opened while the task waited.
    await this.tasksService.assertNoOpenDependencyTickets(taskId, tenantId, 'send to QA');
    await this.tasksService.assertNoOpenLinkedDefects(taskId, tenantId, 'send to QA');
    const comment = dto.comment && richTextToPlainText(dto.comment).trim() ? sanitizeRichText(dto.comment) : null;
    const result = await this.reviewsRepository.manager.transaction((em) => this.forwardToQaWithin(em, task, round, actor, comment, 'pm'));
    this.emitDecided(task, actor, 'sent_to_qa', tenantId);
    return result;
  }

  async sendBack(taskId: number, dto: PmSendBackDto, actor: Actor, tenantId: number) {
    const plain = richTextToPlainText(dto.comment || '').trim();
    if (!plain) throw new BadRequestException('Feedback for the developer is required.');
    const { task, round } = await this.loadDecidable(taskId, tenantId);
    const comment = sanitizeRichText(dto.comment);
    const now = new Date();
    const waited = businessDaysBetween(new Date(round.submittedAt), now);
    await this.reviewsRepository.manager.transaction(async (em) => {
      await this.decideRoundWithin(em, round, 'rejected', actor, comment, now, taskId);
      const upd = await em.update(
        ProjectTask,
        { id: taskId, tenantId, status: PM_REVIEW_STATUS },
        { status: PM_FEEDBACK_STATUS, pmWaitWorkingDays: (task.pmWaitWorkingDays || 0) + waited },
      );
      if (!upd.affected) throw new BadRequestException(`Task #${taskId} changed while you were reviewing it - reload and try again.`);
      await this.auditLogService.recordWithin(em, {
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: AuditActions.TASK_PM_SENT_BACK,
        tenantId,
        entityType: 'ProjectTask',
        entityId: taskId,
        details: { roundNumber: round.roundNumber, comment, waitedWorkingDays: waited, selfReview: this.isSelfReview(task, round, actor) },
      });
    });
    this.emitDecided(task, actor, 'sent_back', tenantId);
    return { task: await this.tasksService.findOne(taskId, tenantId) };
  }

  // Admin view: the per-project switch (with how many tickets each
  // project has waiting, so turning one off can say what will move) and
  // the tenant-wide reminder settings.
  async settings(tenantId: number) {
    const projects = await this.projectsRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
    const waiting: Array<{ projectId: number; n: number }> = await this.tasksRepository.query(
      `SELECT "projectId", count(*)::int AS n FROM project_tasks WHERE "tenantId" = $1 AND status = $2 GROUP BY "projectId"`,
      [tenantId, PM_REVIEW_STATUS],
    );
    const s = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        pmReviewEnabled: !!p.pmReviewEnabled,
        waitingCount: waiting.find((w) => w.projectId === p.id)?.n ?? 0,
      })),
      reminder: { workingDays: s?.pmReminderWorkingDays ?? PM_REMINDER_DEFAULT_DAYS, toAdmin: s?.pmReminderToAdmin ?? true },
    };
  }

  async setReminderSettings(workingDays: number, toAdmin: boolean, actor: Actor, tenantId: number) {
    const existing = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    const before = { workingDays: existing?.pmReminderWorkingDays ?? PM_REMINDER_DEFAULT_DAYS, toAdmin: existing?.pmReminderToAdmin ?? true };
    if (existing) {
      await this.teamSettingsRepository.update({ tenantId }, { pmReminderWorkingDays: workingDays, pmReminderToAdmin: toAdmin, updatedByUserId: actor.id });
    } else {
      await this.teamSettingsRepository.save(
        this.teamSettingsRepository.create({ tenantId, pmReminderWorkingDays: workingDays, pmReminderToAdmin: toAdmin, updatedByUserId: actor.id }),
      );
    }
    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: AuditActions.PM_REVIEW_REMINDER_SETTINGS_UPDATED,
      tenantId,
      entityType: 'TeamSettings',
      entityId: tenantId,
      details: { before, after: { workingDays, toAdmin } },
    });
    return { workingDays, toAdmin };
  }

  // Admin switches the gate for one project. Turning it off sends every
  // ticket still waiting for the PM in that project straight on to QA
  // (as if the PM had clicked Send to QA - audited per ticket); PM
  // Feedback tickets stay with the developer and their next submit goes
  // straight to QA.
  async setSwitch(projectId: number, enabled: boolean, actor: Actor, tenantId: number) {
    const project = await this.projectsRepository.findOne({ where: { id: projectId, tenantId } });
    if (!project) throw new NotFoundException(`Project #${projectId} not found`);
    const movedToQa: number[] = [];
    await this.projectsRepository.manager.transaction(async (em) => {
      await em.update(Project, { id: projectId, tenantId }, { pmReviewEnabled: enabled });
      if (!enabled) {
        const waiting = await em.find(ProjectTask, { where: { tenantId, projectId, status: PM_REVIEW_STATUS } });
        for (const t of waiting) {
          const round = await em.findOne(TaskQaReview, { where: { tenantId, taskId: t.id, status: 'pending', reviewType: 'pm' } });
          if (!round) continue;
          await this.forwardToQaWithin(em, t, round, actor, null, 'switch-off');
          movedToQa.push(t.id);
        }
      }
      await this.auditLogService.recordWithin(em, {
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: AuditActions.PROJECT_PM_REVIEW_SWITCHED,
        tenantId,
        entityType: 'Project',
        entityId: projectId,
        details: { from: !!project.pmReviewEnabled, to: enabled, movedToQaTaskIds: movedToQa },
      });
    });
    return { projectId, pmReviewEnabled: enabled, movedToQaTaskIds: movedToQa };
  }

  // ---------- internals ----------

  private async loadDecidable(taskId: number, tenantId: number): Promise<{ task: ProjectTask; round: TaskQaReview }> {
    const task = await this.tasksService.findOne(taskId, tenantId);
    this.tasksService.assertNotJunk(task);
    this.tasksService.assertReviewDecidable(task);
    const round = await this.reviewsRepository.findOne({ where: { taskId, tenantId, status: 'pending' } });
    if (task.status !== PM_REVIEW_STATUS || !round || round.reviewType !== 'pm') {
      const decided = await this.reviewsRepository.findOne({
        where: { taskId, tenantId, reviewType: 'pm', status: Not('pending') },
        order: { roundNumber: 'DESC' },
      });
      const by = decided?.reviewedByUserId ? (await this.usersService.findByIds([decided.reviewedByUserId], tenantId))[0] : null;
      throw new BadRequestException(
        decided && task.status !== PM_REVIEW_STATUS && by
          ? `Task #${taskId} is not waiting for PM review - ${by.fullName || by.email} already ${decided.status === 'approved' ? 'sent it to QA' : 'sent it back'}.`
          : `Task #${taskId} is not waiting for PM review (it is ${task.status}).`,
      );
    }
    return { task, round };
  }

  private async decideRoundWithin(em: EntityManager, round: TaskQaReview, status: 'approved' | 'rejected', actor: Actor, comment: string | null, now: Date, taskId: number) {
    const upd = await em.update(
      TaskQaReview,
      { id: round.id, status: 'pending', reviewType: 'pm' },
      { status, reviewedByUserId: actor.id, reviewedByEmail: actor.email, reviewedAt: now, qaComment: comment },
    );
    if (!upd.affected) throw new BadRequestException(`Another reviewer has just decided task #${taskId} - reload to see it.`);
  }

  // Closes the pending PM round as approved and opens the QA round - the
  // same end state a developer submit produces without the gate.
  private async forwardToQaWithin(em: EntityManager, task: ProjectTask, round: TaskQaReview, actor: Actor, comment: string | null, source: 'pm' | 'switch-off') {
    const now = new Date();
    const tenantId = task.tenantId;
    const waited = businessDaysBetween(new Date(round.submittedAt), now);
    await this.decideRoundWithin(em, round, 'approved', actor, comment, now, task.id);
    // Same first-time/resubmission split as TaskQaReviewsService.submit().
    const priorQaRounds = await em.count(TaskQaReview, {
      where: { tenantId, taskId: task.id, reviewType: Not('pm'), status: Not(In(NON_VERDICT_ROUND_STATUSES)) },
    });
    const status = priorQaRounds === 0 ? 'Feedback' : 'Re-Feedback';
    const upd = await em.update(
      ProjectTask,
      { id: task.id, tenantId, status: PM_REVIEW_STATUS },
      { status, qaReviewDueDate: this.tasksService.computeQaReviewDueDate(now), pmWaitWorkingDays: (task.pmWaitWorkingDays || 0) + waited },
    );
    if (!upd.affected) throw new BadRequestException(`Task #${task.id} changed while you were reviewing it - reload and try again.`);
    const roundCount = await em.count(TaskQaReview, { where: { tenantId, taskId: task.id } });
    const qaRound = await em.save(
      TaskQaReview,
      em.create(TaskQaReview, {
        tenantId,
        taskId: task.id,
        roundNumber: roundCount + 1,
        resolution: round.resolution,
        submittedByUserId: round.submittedByUserId,
        submittedByEmail: round.submittedByEmail,
        status: 'pending',
        reviewType: 'qa',
        noteQualityFlagged: round.noteQualityFlagged,
        noteQualityReason: round.noteQualityReason,
      }),
    );
    const evidence = await em.find(TaskQaReviewArtifact, { where: { taskQaReviewId: round.id } });
    if (evidence.length > 0) {
      await em.save(
        TaskQaReviewArtifact,
        evidence.map((a) => em.create(TaskQaReviewArtifact, { taskQaReviewId: qaRound.id, type: a.type, url: a.url })),
      );
    }
    await this.auditLogService.recordWithin(em, {
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: AuditActions.TASK_PM_SENT_TO_QA,
      tenantId,
      entityType: 'ProjectTask',
      entityId: task.id,
      details: {
        roundNumber: round.roundNumber,
        qaRoundNumber: qaRound.roundNumber,
        statusTo: status,
        comment,
        waitedWorkingDays: waited,
        selfReview: this.isSelfReview(task, round, actor),
        source,
      },
    });
    return { taskId: task.id, status, qaRoundNumber: qaRound.roundNumber };
  }

  private isSelfReview(task: ProjectTask, round: TaskQaReview, actor: Actor): boolean {
    return actor.id === task.assigneeUserId || actor.id === round.submittedByUserId;
  }

  private emitDecided(task: ProjectTask, actor: Actor, decision: 'sent_to_qa' | 'sent_back', tenantId: number) {
    this.eventEmitter.emit('task.pmReviewDecided', {
      tenantId,
      taskId: task.id,
      title: task.title,
      assigneeUserId: task.assigneeUserId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      decision,
    });
  }
}
