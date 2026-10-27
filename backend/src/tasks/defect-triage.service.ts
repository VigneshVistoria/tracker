import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { DefectTriage } from './defect-triage.entity';
import { Project } from '../projects/project.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TasksService, JUNK_STATUS } from './tasks.service';
import { UsersService } from '../users/users.service';
import { User, UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { businessDaysBetween, toDateOnlyString } from '../common/business-days';
import {
  CLASSIFICATION_FIELDS,
  DEFECT_TRIAGE_AUDIT,
  DISPUTE_COMMENT_MIN,
  DISPUTED_STATUS,
  DefectDisputeDecidedEvent,
  DefectDisputedEvent,
  DefectTriageOverdueEvent,
  DefectTriageSettings,
  LIST_ITEM_MAX,
  LIST_MAX_COUNT,
  PmDisputeDecision,
  resolveDefectTriageSettings,
} from './defect-triage';
import { DecideDisputeDto, DisputeDefectDto, SaveDefectTriageSettingsDto, UpdateDefectClassificationDto } from './dto/defect-triage.dto';

type Actor = { id: number; email: string; role: UserRole };

// Admin and Program Manager edit the lists and switch projects; the PM
// (or an Admin, as with PM review) decides disputes.
export const DEFECT_TRIAGE_SETTINGS_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
export const DEFECT_DISPUTE_DECIDE_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];

// Statuses in which a defect waiting for triage is parked - no clock, no
// reminder, never late while there.
const PARKED_STATUSES = ['Hold', 'Closed', JUNK_STATUS];

const PM_DECISION_LABEL: Record<PmDisputeDecision, string> = {
  rejected: 'Dispute rejected - the developer fixes it',
  closed: 'Agreed - defect closed',
  reassigned: 'Agreed - reassigned to another developer',
  converted: 'Agreed - converted to a Backlog task',
};

// See ./defect-triage.ts for the rules.
@Injectable()
export class DefectTriageService {
  private readonly logger = new Logger(DefectTriageService.name);

  constructor(
    @InjectRepository(DefectTriage)
    private triagesRepository: Repository<DefectTriage>,
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TeamSettings)
    private teamSettingsRepository: Repository<TeamSettings>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private dataSource: DataSource,
  ) {}

  // ---------- settings ----------

  // Admin -> Defect Triage Settings: the lists and rules, and every
  // project's switch with how many defects wait for triage / the PM there.
  async settingsPage(tenantId: number) {
    const settings = await this.tasksService.defectTriageSettings(tenantId);
    const projects = await this.dataSource.getRepository(Project).find({ where: { tenantId }, order: { name: 'ASC' } });
    const counts: Array<{ projectId: number; pending: number; disputed: number }> = await this.tasksRepository.query(
      `SELECT "projectId",
              count(*) FILTER (WHERE "triageStatus" = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = $2)::int AS disputed
         FROM project_tasks WHERE "tenantId" = $1 AND "isDefect" = true AND status <> $3 GROUP BY "projectId"`,
      [tenantId, DISPUTED_STATUS, JUNK_STATUS],
    );
    return {
      settings,
      projects: projects.map((p) => {
        const c = counts.find((x) => x.projectId === p.id);
        return { id: p.id, name: p.name, defectTriageEnabled: !!p.defectTriageEnabled, pendingCount: c?.pending ?? 0, disputedCount: c?.disputed ?? 0 };
      }),
    };
  }

  // What the Create Defect page and the reject form need: the lists, the
  // required fields, and which projects are switched on.
  async options(tenantId: number) {
    const settings = await this.tasksService.defectTriageSettings(tenantId);
    const on = await this.dataSource.getRepository(Project).find({ where: { tenantId, defectTriageEnabled: true }, select: ['id'] });
    return {
      enabledProjectIds: on.map((p) => p.id),
      severities: settings.severities,
      types: settings.types,
      origins: settings.origins,
      environments: settings.environments,
      requiredFields: settings.requiredFields,
      triageWorkingDays: settings.triageWorkingDays,
    };
  }

  async saveSettings(dto: SaveDefectTriageSettingsDto, actor: Actor, tenantId: number): Promise<DefectTriageSettings> {
    const clean = (items: string[], what: string) => {
      const out: string[] = [];
      for (const raw of items) {
        const v = (raw || '').trim();
        if (v && v.length <= LIST_ITEM_MAX && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
      }
      if (out.length === 0) throw new BadRequestException(`Keep at least one ${what}.`);
      if (out.length > LIST_MAX_COUNT) throw new BadRequestException(`No more than ${LIST_MAX_COUNT} ${what}s.`);
      return out;
    };
    const reasons: DefectTriageSettings['disputeReasons'] = [];
    for (const r of dto.disputeReasons) {
      const label = (r.label || '').trim();
      if (label && !reasons.some((x) => x.label.toLowerCase() === label.toLowerCase())) {
        reasons.push({ label, needsTicket: !!r.needsTicket, notLateTriage: !!r.notLateTriage });
      }
    }
    if (reasons.length === 0) throw new BadRequestException('Keep at least one dispute reason.');
    const next: DefectTriageSettings = {
      severities: clean(dto.severities, 'severity'),
      types: clean(dto.types, 'defect type'),
      origins: clean(dto.origins, 'origin'),
      environments: clean(dto.environments, 'environment'),
      disputeReasons: reasons,
      requiredFields: CLASSIFICATION_FIELDS.filter((f) => dto.requiredFields.includes(f)),
      triageWorkingDays: dto.triageWorkingDays,
    };
    const before = await this.tasksService.defectTriageSettings(tenantId);
    const existing = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    if (existing) {
      await this.teamSettingsRepository.update({ tenantId }, { defectTriageSettings: next as any, updatedByUserId: actor.id });
    } else {
      await this.teamSettingsRepository.save(this.teamSettingsRepository.create({ tenantId, defectTriageSettings: next as any, updatedByUserId: actor.id }));
    }
    await this.auditLogService.record({
      ...this.auditActor(actor, tenantId, 'TeamSettings', tenantId),
      action: DEFECT_TRIAGE_AUDIT.SETTINGS_UPDATED,
      details: { before, after: next },
    });
    return resolveDefectTriageSettings(next);
  }

  // Switching a project off: defects there still waiting for triage stop
  // needing it (their clock is closed, never late). Disputed ones stay with
  // the PM until decided. Switching on affects new defects only.
  async setProjectSwitch(projectId: number, enabled: boolean, actor: Actor, tenantId: number) {
    const project = await this.dataSource.getRepository(Project).findOne({ where: { id: projectId, tenantId } });
    if (!project) throw new NotFoundException(`Project #${projectId} not found`);
    let released: number[] = [];
    await this.dataSource.transaction(async (em) => {
      await em.update(Project, { id: projectId, tenantId }, { defectTriageEnabled: enabled });
      if (!enabled) {
        const pending = await em.find(ProjectTask, { where: { tenantId, projectId, isDefect: true, triageStatus: 'pending' }, select: ['id'] });
        released = pending.map((t) => t.id);
        if (released.length) {
          await em.update(ProjectTask, { tenantId, id: In(released) }, { triageStatus: null });
          await em.update(DefectTriage, { tenantId, taskId: In(released), decision: IsNull() }, { decision: 'superseded', decidedAt: new Date() });
        }
      }
      await this.auditLogService.recordWithin(em, {
        ...this.auditActor(actor, tenantId, 'Project', projectId),
        action: DEFECT_TRIAGE_AUDIT.PROJECT_SWITCHED,
        details: { from: !!project.defectTriageEnabled, to: enabled, triageReleasedTaskIds: released },
      });
    });
    return { projectId, defectTriageEnabled: enabled, triageReleasedTaskIds: released };
  }

  // ---------- the task page ----------

  async state(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    if (!task.isDefect) return { applies: false };
    const projectOn = await this.tasksService.defectTriageOn(task.projectId, tenantId);
    const hasClassification = CLASSIFICATION_FIELDS.some((f) => !!task[f]);
    const rows = await this.triagesRepository.find({ where: { tenantId, taskId }, order: { id: 'DESC' } });
    if (!projectOn && !hasClassification && !task.triageStatus && rows.length === 0) return { applies: false };

    const settings = await this.tasksService.defectTriageSettings(tenantId);
    const isAssignee = task.assigneeUserId === user.id;
    const isLeadership = DEFECT_DISPUTE_DECIDE_ROLES.includes(user.role);
    const pending = task.triageStatus === 'pending' && !PARKED_STATUSES.includes(task.status);
    const canEditClassification = projectOn && task.status !== JUNK_STATUS && (isLeadership || (user.role === UserRole.QA && task.createdByUserId === user.id));
    const names = await this.namesFor(rows.flatMap((r) => [r.assigneeUserId, r.reassignedToUserId].filter((x): x is number => !!x)), tenantId);
    return {
      applies: true,
      projectOn,
      triageStatus: task.triageStatus,
      classification: Object.fromEntries(CLASSIFICATION_FIELDS.map((f) => [f, task[f] ?? null])),
      history: rows.map((r) => ({
        ...r,
        assigneeName: names.get(r.assigneeUserId) ?? r.assigneeEmail,
        reassignedToName: r.reassignedToUserId ? names.get(r.reassignedToUserId) ?? null : null,
        pmDecisionLabel: r.pmDecision ? PM_DECISION_LABEL[r.pmDecision] : null,
        late: this.isLate(r, task, new Date()),
      })),
      canAccept: isAssignee && pending,
      canDispute: isAssignee && pending && task.status === 'Development',
      canDecide: isLeadership && task.status === DISPUTED_STATUS,
      canEditClassification,
      disputeReasons: isAssignee && pending ? settings.disputeReasons : [],
      options: canEditClassification
        ? { severities: settings.severities, types: settings.types, origins: settings.origins, environments: settings.environments, requiredFields: settings.requiredFields }
        : null,
    };
  }

  async accept(taskId: number, user: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    this.assertCanTriage(task, user);
    const now = new Date();
    await this.dataSource.transaction(async (em) => {
      const updated = await em.update(ProjectTask, { id: taskId, tenantId, triageStatus: 'pending' }, { triageStatus: 'accepted' });
      if (!updated.affected) throw new BadRequestException(`#${taskId} changed while you were on it - reload and try again.`);
      const row = await this.openRowWithin(em, task, now);
      await em.update(DefectTriage, { id: row.id }, { decision: 'accepted', decidedAt: now });
      await this.auditLogService.recordWithin(em, {
        ...this.auditActor(user, tenantId, 'ProjectTask', taskId),
        action: DEFECT_TRIAGE_AUDIT.ACCEPTED,
        details: { triageId: row.id, dueDate: row.dueDate },
      });
    });
    return { task: await this.tasksService.findOne(taskId, tenantId) };
  }

  async dispute(taskId: number, dto: DisputeDefectDto, user: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    this.assertCanTriage(task, user);
    if (task.status !== 'Development') {
      throw new BadRequestException(`#${taskId} is ${task.status} - a defect can only be disputed while it is in Development.`);
    }
    const settings = await this.tasksService.defectTriageSettings(tenantId);
    const reason = settings.disputeReasons.find((r) => r.label.toLowerCase() === (dto.reason || '').trim().toLowerCase());
    if (!reason) throw new BadRequestException('Pick a reason from the list - reload the page if it has changed.');
    const comment = (dto.comment || '').trim();
    if (comment.length < DISPUTE_COMMENT_MIN) {
      throw new BadRequestException(`Explain the dispute in at least ${DISPUTE_COMMENT_MIN} characters.`);
    }
    let duplicateOfTaskId: number | null = null;
    if (reason.needsTicket) {
      if (!dto.duplicateOfTaskId) throw new BadRequestException(`"${reason.label}" needs the number of the ticket it duplicates.`);
      if (dto.duplicateOfTaskId === taskId) throw new BadRequestException('A defect cannot duplicate itself.');
      const original = await this.tasksRepository.findOne({ where: { id: dto.duplicateOfTaskId, tenantId }, select: ['id'] });
      if (!original) throw new BadRequestException(`Ticket #${dto.duplicateOfTaskId} does not exist.`);
      duplicateOfTaskId = original.id;
    }
    const now = new Date();
    await this.dataSource.transaction(async (em) => {
      const updated = await em.update(
        ProjectTask,
        { id: taskId, tenantId, triageStatus: 'pending', status: 'Development' },
        { triageStatus: 'disputed', status: DISPUTED_STATUS },
      );
      if (!updated.affected) throw new BadRequestException(`#${taskId} changed while you were on it - reload and try again.`);
      const row = await this.openRowWithin(em, task, now);
      await em.update(
        DefectTriage,
        { id: row.id },
        { decision: 'disputed', decidedAt: now, disputeReason: reason.label, disputeComment: comment, duplicateOfTaskId, lateExempt: reason.notLateTriage },
      );
      await this.auditLogService.recordWithin(em, {
        ...this.auditActor(user, tenantId, 'ProjectTask', taskId),
        action: DEFECT_TRIAGE_AUDIT.DISPUTED,
        details: { triageId: row.id, reason: reason.label, comment, duplicateOfTaskId, statusFrom: 'Development', statusTo: DISPUTED_STATUS },
      });
    });
    const event: DefectDisputedEvent = {
      tenantId,
      taskId,
      title: task.title,
      reason: reason.label,
      qaUserId: task.createdByUserId ?? null,
      actorUserId: user.id,
      actorEmail: user.email,
    };
    this.eventEmitter.emit('defect.disputed', event);
    return { task: await this.tasksService.findOne(taskId, tenantId) };
  }

  async decide(taskId: number, dto: DecideDisputeDto, user: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    this.tasksService.assertNotJunk(task);
    if (task.status !== DISPUTED_STATUS) {
      throw new BadRequestException(`#${taskId} is not disputed (it is ${task.status}) - reload to see it.`);
    }
    const row = await this.triagesRepository.findOne({
      where: { tenantId, taskId, decision: 'disputed', pmDecision: IsNull() },
      order: { id: 'DESC' },
    });
    if (!row) throw new BadRequestException(`#${taskId} has no open dispute - reload to see it.`);
    const comment = (dto.comment || '').trim() || null;
    if (dto.decision === 'rejected' && (!comment || comment.length < DISPUTE_COMMENT_MIN)) {
      throw new BadRequestException(`Tell the developer why in at least ${DISPUTE_COMMENT_MIN} characters.`);
    }
    let newAssignee: User | null = null;
    if (dto.decision === 'reassigned') {
      if (!dto.assigneeUserId) throw new BadRequestException('Pick the developer to reassign it to.');
      newAssignee = await this.usersService.findByIdAndTenant(dto.assigneeUserId, tenantId);
      if (!newAssignee) throw new NotFoundException(`User #${dto.assigneeUserId} not found`);
      if (!DEVELOPER_EQUIVALENT_ROLES.includes(newAssignee.role)) {
        throw new BadRequestException('A defect can only be assigned to a Developer, Designer, or DevOps.');
      }
      if (newAssignee.id === task.assigneeUserId) throw new BadRequestException('Pick a different developer - this one disputed it.');
    }

    const now = new Date();
    // Days with the PM never count against the developer.
    const waited = row.decidedAt ? businessDaysBetween(new Date(row.decidedAt), now) : 0;
    const developerUserId = task.assigneeUserId;
    await this.dataSource.transaction(async (em) => {
      let changes: Partial<ProjectTask>;
      if (dto.decision === 'rejected') {
        changes = { status: 'Development', triageStatus: 'accepted', pmWaitWorkingDays: (task.pmWaitWorkingDays || 0) + waited };
      } else if (dto.decision === 'reassigned') {
        // A fresh assignment, like Create Defect: the new developer sets
        // their own estimate and due date and triages it on a new clock.
        changes = {
          status: 'Development',
          triageStatus: 'pending',
          assigneeUserId: newAssignee!.id,
          assigneeEmail: newAssignee!.email,
          estimatedHours: null as any,
          dueDate: null as any,
          pmWaitWorkingDays: 0,
        };
      } else {
        // closed / converted: closed with the reason on record; a PM can
        // reopen it later (back to Development, no triage needed).
        changes = { status: 'Closed', priorStatus: 'Development', pmWaitWorkingDays: (task.pmWaitWorkingDays || 0) + waited };
      }
      const updated = await em.update(ProjectTask, { id: taskId, tenantId, status: DISPUTED_STATUS }, changes);
      if (!updated.affected) throw new BadRequestException(`#${taskId} changed while you were on it - reload and try again.`);
      await em.update(
        DefectTriage,
        { id: row.id },
        {
          pmDecision: dto.decision,
          pmComment: comment,
          pmDecidedAt: now,
          pmDecidedByUserId: user.id,
          pmDecidedByEmail: user.email,
          reassignedToUserId: newAssignee?.id ?? null,
        },
      );
      if (newAssignee) {
        await this.tasksService.startTriageWithin(em, { ...task, ...changes } as ProjectTask, await this.tasksService.defectTriageSettings(tenantId), now);
      }
      await this.auditLogService.recordWithin(em, {
        ...this.auditActor(user, tenantId, 'ProjectTask', taskId),
        action: DEFECT_TRIAGE_AUDIT.DISPUTE_DECIDED,
        details: {
          triageId: row.id,
          decision: dto.decision,
          comment,
          disputeReason: row.disputeReason,
          waitedWorkingDays: waited,
          statusFrom: DISPUTED_STATUS,
          statusTo: changes.status,
          previousAssigneeUserId: developerUserId,
          assigneeUserId: newAssignee?.id ?? developerUserId,
        },
      });
    });

    let convertedTaskId: number | null = null;
    if (dto.decision === 'converted') {
      // A new Backlog task with the defect's scope and text; the defect
      // stays Closed and points to it.
      const created = await this.tasksService.create(
        { projectId: task.projectId, moduleId: task.moduleId, phaseId: task.phaseId, title: task.title, description: task.description },
        user,
        tenantId,
      );
      convertedTaskId = created.id;
      await this.triagesRepository.update({ id: row.id }, { convertedTaskId });
    }

    const after = await this.tasksService.findOne(taskId, tenantId);
    if (newAssignee) this.tasksService.emitAssigned(after, user, tenantId);
    const event: DefectDisputeDecidedEvent = {
      tenantId,
      taskId,
      title: task.title,
      decision: dto.decision,
      comment,
      developerUserId,
      qaUserId: task.createdByUserId ?? null,
      convertedTaskId,
      actorUserId: user.id,
      actorEmail: user.email,
    };
    this.eventEmitter.emit('defect.disputeDecided', event);
    return { task: after, convertedTaskId };
  }

  // QA who raised it, or a PM/Admin, corrects the classification. Required
  // fields stay required.
  async updateClassification(taskId: number, dto: UpdateDefectClassificationDto, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    this.tasksService.assertNotJunk(task);
    if (!task.isDefect) throw new BadRequestException(`#${taskId} is not a defect.`);
    const isLeadership = DEFECT_DISPUTE_DECIDE_ROLES.includes(user.role);
    if (!isLeadership && !(user.role === UserRole.QA && task.createdByUserId === user.id)) {
      throw new ForbiddenException('Only the QA who raised this defect or a Program Manager can change its classification.');
    }
    if (!(await this.tasksService.defectTriageOn(task.projectId, tenantId))) {
      throw new BadRequestException(`Defect triage is off for ${task.projectName}.`);
    }
    const settings = await this.tasksService.defectTriageSettings(tenantId);
    const values = this.tasksService.cleanClassification(dto, settings, true);
    const before = Object.fromEntries(CLASSIFICATION_FIELDS.map((f) => [f, task[f] ?? null]));
    await this.dataSource.transaction(async (em) => {
      await em.update(ProjectTask, { id: taskId, tenantId }, values);
      await this.auditLogService.recordWithin(em, {
        ...this.auditActor(user, tenantId, 'ProjectTask', taskId),
        action: DEFECT_TRIAGE_AUDIT.CLASSIFICATION_UPDATED,
        details: { before, after: values },
      });
    });
    return { task: await this.tasksService.findOne(taskId, tenantId) };
  }

  // ---------- lists ----------

  // PM: disputed defects waiting for a decision, longest waiting first.
  async queue(tenantId: number) {
    const tasks = await this.tasksRepository.find({ where: { tenantId, status: DISPUTED_STATUS }, order: { id: 'ASC' } });
    if (!tasks.length) return { items: [] };
    const rows = await this.triagesRepository.find({
      where: { tenantId, taskId: In(tasks.map((t) => t.id)), decision: 'disputed', pmDecision: IsNull() },
      order: { id: 'DESC' },
    });
    const names = await this.namesFor(tasks.map((t) => t.assigneeUserId).filter(Boolean), tenantId);
    const now = new Date();
    const items = tasks
      .map((t) => {
        const r = rows.find((x) => x.taskId === t.id);
        return {
          taskId: t.id,
          title: t.title,
          projectName: t.projectName,
          moduleName: t.moduleName,
          severity: t.severity,
          developerName: names.get(t.assigneeUserId) ?? t.assigneeEmail,
          raisedByEmail: t.createdByEmail,
          reason: r?.disputeReason ?? null,
          comment: r?.disputeComment ?? null,
          duplicateOfTaskId: r?.duplicateOfTaskId ?? null,
          disputedAt: r?.decidedAt ?? null,
          waitingWorkingDays: r?.decidedAt ? businessDaysBetween(new Date(r.decidedAt), now) : 0,
        };
      })
      .sort((a, b) => b.waitingWorkingDays - a.waitingWorkingDays || a.taskId - b.taskId);
    return { items };
  }

  // Developer: my defects waiting for Accept/Dispute, due first.
  async mine(user: User, tenantId: number) {
    const tasks = await this.tasksRepository.find({
      where: { tenantId, assigneeUserId: user.id, isDefect: true, triageStatus: 'pending', status: Not(In(PARKED_STATUSES)) },
    });
    if (!tasks.length) return [];
    const rows = await this.triagesRepository.find({ where: { tenantId, taskId: In(tasks.map((t) => t.id)), decision: IsNull() } });
    const today = toDateOnlyString(new Date());
    return tasks
      .map((t) => {
        const r = rows.find((x) => x.taskId === t.id);
        return {
          id: t.id,
          title: t.title,
          projectName: t.projectName,
          severity: t.severity,
          raisedByEmail: t.createdByEmail,
          dueDate: r?.dueDate ?? null,
          late: !!r && r.dueDate < today,
        };
      })
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id - b.id);
  }

  // ---------- late triage ----------

  // Late = decided after the due date, or still waiting past it (and not
  // parked). Superseded clocks and exempt dispute reasons never are.
  isLate(row: DefectTriage, task: { status: string; triageStatus: string | null }, now: Date): boolean {
    if (row.decision === 'superseded' || row.lateExempt) return false;
    if (row.decision) return !!row.decidedAt && toDateOnlyString(new Date(row.decidedAt)) > row.dueDate;
    return task.triageStatus === 'pending' && !PARKED_STATUSES.includes(task.status) && toDateOnlyString(now) > row.dueDate;
  }

  // Hourly: once a clock has run out with no decision, remind the
  // developer once (stamped with a guarded update, so it goes out once
  // even if two runs overlap). In-app only.
  @Cron('15 * * * *')
  async run() {
    try {
      const sent = await this.remindOverdue(new Date());
      if (sent.length) this.logger.log(`Late triage reminders: ${sent.length}`);
    } catch (err: any) {
      this.logger.error(`Late triage reminders failed: ${err.message}`);
    }
  }

  async remindOverdue(now: Date): Promise<number[]> {
    const today = toDateOnlyString(now);
    const rows = await this.triagesRepository.find({ where: { decision: IsNull(), reminderSentAt: IsNull(), dueDate: LessThan(today) } });
    if (!rows.length) return [];
    const tasks = await this.tasksRepository.find({ where: { id: In(rows.map((r) => r.taskId)) } });
    const sent: number[] = [];
    for (const r of rows) {
      const task = tasks.find((t) => t.id === r.taskId);
      if (!task || task.tenantId !== r.tenantId || task.assigneeUserId !== r.assigneeUserId || !this.isLate(r, task, now)) continue;
      const upd = await this.triagesRepository.update({ id: r.id, reminderSentAt: IsNull() }, { reminderSentAt: now });
      if (!upd.affected) continue;
      const event: DefectTriageOverdueEvent = { tenantId: r.tenantId, taskId: task.id, title: task.title, assigneeUserId: r.assigneeUserId, dueDate: r.dueDate };
      this.eventEmitter.emit('defect.triageOverdue', event);
      sent.push(task.id);
    }
    return sent;
  }

  // ---------- internals ----------

  private assertCanTriage(task: ProjectTask, user: User) {
    this.tasksService.assertNotJunk(task);
    if (!task.isDefect) throw new BadRequestException(`#${task.id} is not a defect.`);
    if (task.assigneeUserId !== user.id) throw new ForbiddenException('Only the developer this defect is assigned to can accept or dispute it.');
    if (task.triageStatus !== 'pending') {
      throw new BadRequestException(
        task.triageStatus === 'accepted'
          ? `#${task.id} is already accepted.`
          : task.triageStatus === 'disputed'
            ? `#${task.id} is already disputed.`
            : `#${task.id} does not need triage.`,
      );
    }
    if (PARKED_STATUSES.includes(task.status)) {
      throw new BadRequestException(`#${task.id} is ${task.status === 'Hold' ? 'on Hold' : task.status} - ask the PM to release it first.`);
    }
  }

  // The open clock for the current assignee; if one is somehow missing, a
  // clock is opened now so the decision is still recorded.
  private async openRowWithin(em: import('typeorm').EntityManager, task: ProjectTask, now: Date): Promise<DefectTriage> {
    const row = await em.findOne(DefectTriage, { where: { tenantId: task.tenantId, taskId: task.id, decision: IsNull() }, order: { id: 'DESC' } });
    if (row) return row;
    return this.tasksService.startTriageWithin(em, task, await this.tasksService.defectTriageSettings(task.tenantId), now);
  }

  private async viewable(taskId: number, user: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (task.status === JUNK_STATUS && !this.tasksService.canSeeJunk(user)) throw new NotFoundException('Not found');
    if (!(await this.tasksService.canView(task, user))) throw new ForbiddenException('You do not have access to this task.');
    return task;
  }

  private async namesFor(ids: number[], tenantId: number): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const users = await this.usersService.findByIds(unique, tenantId);
    return new Map(users.map((u) => [u.id, u.fullName || u.email]));
  }

  private auditActor(user: Actor, tenantId: number, entityType: string, entityId: number) {
    return { userId: user.id, userEmail: user.email, userRole: user.role, tenantId, entityType, entityId };
  }
}
