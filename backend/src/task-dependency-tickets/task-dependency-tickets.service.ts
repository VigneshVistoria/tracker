import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { sanitizeRichText } from '../common/sanitize-rich-text';
import {
  DEPENDENCY_TASKS_SWITCH_ROLES,
  DEPENDENCY_TASK_AUDIT,
  DEPENDENCY_TASK_RESOLVED_STATUSES,
  DependencyTaskSummary,
  dependencyTaskStatusLabel,
} from './dependency-tasks';
import { TaskDependencyTicket } from './task-dependency-ticket.entity';
import { CreateTaskDependencyTicketDto } from './dto/create-task-dependency-ticket.dto';
import { UpdateTaskDependencyTicketTitleDto } from './dto/update-task-dependency-ticket-title.dto';
import { ChangeTaskDependencyTicketOwnerDto } from './dto/change-task-dependency-ticket-owner.dto';
import { TasksService, JUNK_STATUS } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { Project } from '../projects/project.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TEAM_SETTINGS_DEFAULTS, dateInZone, isValidTimeZone } from '../team-settings/time-zone';
import { FLAG_REASON_MIN, TASK_FLAG_AUDIT, canChangeNeedBy, needByOverdueAt } from '../task-flags/task-flags';
import { ChangeNeedByDateDto } from '../task-flags/dto/task-flags.dto';

export interface TaskDependencyTicketWithParent extends TaskDependencyTicket {
  parentTaskTitle: string | null;
  parentTaskDueDate: string | null;
  // Added 2026-10-07 for the Dashboard / Dependency Clearance ticket view
  // (display names instead of emails, and the parent task's context).
  // Read-only lookups of existing columns - no schema change.
  createdByName: string | null;
  ownerName: string | null;
  parentTaskStatus: string | null;
  parentTaskPriority: string | null;
  parentTaskProjectName: string | null;
  parentTaskModuleName: string | null;
  parentTaskPhaseName: string | null;
  // Dependency tasks Stage 2: the linked task, or null (switch off, older
  // ticket, or external owner).
  dependencyTask: DependencyTaskSummary | null;
}

@Injectable()
export class TaskDependencyTicketsService {
  constructor(
    @InjectRepository(TaskDependencyTicket)
    private ticketsRepository: Repository<TaskDependencyTicket>,
    @InjectRepository(Project)
    private projectsRepository: Repository<Project>,
    @InjectRepository(TeamSettings)
    private teamSettingsRepository: Repository<TeamSettings>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private dataSource: DataSource,
  ) {}

  // ---- Dependency tasks (2026-11-05, see ./dependency-tasks.ts) ----

  // Every project with its switch, for the Admin / PM settings list.
  async listProjectSwitches(currentUser: { role: UserRole }, tenantId: number) {
    if (!DEPENDENCY_TASKS_SWITCH_ROLES.includes(currentUser.role)) {
      throw new ForbiddenException('Only Admin or Program Manager can see the dependency task switches.');
    }
    const projects = await this.projectsRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
    return projects.map((p) => ({ id: p.id, name: p.name, dependencyTasksEnabled: !!p.dependencyTasksEnabled }));
  }

  // Switching on affects tickets raised from then on; switching off stops
  // new tasks being made. Tasks already linked keep working either way.
  async setProjectSwitch(
    projectId: number,
    enabled: boolean,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ) {
    if (!DEPENDENCY_TASKS_SWITCH_ROLES.includes(currentUser.role)) {
      throw new ForbiddenException('Only Admin or Program Manager can switch dependency tasks on or off.');
    }
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled must be true or false.');
    }
    const project = await this.projectsRepository.findOne({ where: { id: projectId, tenantId } });
    if (!project) {
      throw new NotFoundException(`Project #${projectId} not found`);
    }
    const from = !!project.dependencyTasksEnabled;
    if (from !== enabled) {
      await this.dataSource.transaction(async (em) => {
        await em.update(Project, { id: projectId, tenantId }, { dependencyTasksEnabled: enabled });
        await this.auditLogService.recordWithin(em, {
          userId: currentUser.id,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          action: DEPENDENCY_TASK_AUDIT.PROJECT_SWITCHED,
          tenantId,
          entityType: 'Project',
          entityId: projectId,
          details: { from, to: enabled },
        });
      });
    }
    return { projectId, name: project.name, dependencyTasksEnabled: enabled };
  }

  // The task linked to a ticket, if any.
  private linkedTask(em: EntityManager, ticketId: number, tenantId: number): Promise<ProjectTask | null> {
    return em.findOne(ProjectTask, { where: { dependencyTicketId: ticketId, tenantId } });
  }

  // Dependency tasks Stage 2: the linked task of each ticket (status,
  // estimate, due date, latest progress note), keyed by ticket id. One
  // query for the whole list.
  async dependencyTaskSummaries(ticketIds: number[], tenantId: number): Promise<Map<number, DependencyTaskSummary>> {
    const out = new Map<number, DependencyTaskSummary>();
    if (!ticketIds.length) return out;
    const rows: any[] = await this.dataSource.query(
      `SELECT t.id, t."dependencyTicketId", t.status, t."assigneeUserId", t."estimatedHours", t."dueDate"::text AS "dueDate", t."dueDateCommittedAt",
              (SELECT json_build_object('body', n.body, 'createdAt', n."createdAt")
                 FROM task_progress_notes n
                WHERE n."taskId" = t.id AND n."tenantId" = t."tenantId"
                ORDER BY n."createdAt" DESC, n.id DESC LIMIT 1) AS "lastProgressNote"
         FROM project_tasks t
        WHERE t."tenantId" = $1 AND t."dependencyTicketId" = ANY($2::int[])`,
      [tenantId, ticketIds],
    );
    for (const r of rows) {
      out.set(r.dependencyTicketId, {
        id: r.id,
        status: r.status,
        statusLabel: dependencyTaskStatusLabel(r.status),
        assigneeUserId: r.assigneeUserId ?? null,
        estimatedHours: r.estimatedHours == null ? null : Number(r.estimatedHours),
        dueDate: r.dueDate ?? null,
        dueDateCommittedAt: r.dueDateCommittedAt ?? null,
        lastProgressNote: r.lastProgressNote ?? null,
      });
    }
    return out;
  }

  // Dependency tasks Stage 2: one ticket, for the banner on its dependency
  // task's page. Visible to whoever can see the parent task, the ticket's
  // owner, or whoever can see the dependency task itself.
  async findOneForViewer(id: number, currentUser: any, tenantId: number): Promise<TaskDependencyTicketWithParent> {
    const ticket = await this.ticketsRepository.findOne({ where: { id, tenantId } });
    if (!ticket) throw new NotFoundException('Dependency ticket not found.');
    const [enriched] = await this.withParentTaskFields([ticket], tenantId, { keepJunkParents: true });
    let allowed = ticket.ownerUserId === currentUser.id || ticket.createdByUserId === currentUser.id;
    if (!allowed) {
      const parent = await this.tasksService.findOne(ticket.parentTaskId, tenantId);
      allowed = await this.tasksService.canView(parent, currentUser);
    }
    if (!allowed && enriched.dependencyTask) {
      const task = await this.tasksService.findOne(enriched.dependencyTask.id, tenantId);
      allowed = await this.tasksService.canView(task, currentUser);
    }
    if (!allowed) throw new ForbiddenException('You do not have access to this dependency ticket.');
    return enriched;
  }

  // Combined task detail view - dependency tickets filed against a given
  // parent task, with owner/filer full names for display (2026-10-14), and
  // the linked dependency task's progress (Stage 2).
  async findForTask(
    parentTaskId: number,
    tenantId: number,
  ): Promise<Array<TaskDependencyTicket & { ownerName: string | null; createdByName: string | null; dependencyTask: DependencyTaskSummary | null }>> {
    const tickets = await this.ticketsRepository.find({
      where: { parentTaskId, tenantId },
      order: { createdAt: 'DESC' },
    });
    const userIds = [...new Set(tickets.flatMap((t) => [t.createdByUserId, t.ownerUserId]).filter((id) => id != null))];
    const users = await this.usersService.findByIds(userIds, tenantId);
    const nameById = new Map(users.map((u) => [u.id, u.fullName || null]));
    const linked = await this.dependencyTaskSummaries(tickets.map((t) => t.id), tenantId);
    return tickets.map((t) => ({
      ...t,
      ownerName: nameById.get(t.ownerUserId) ?? null,
      createdByName: nameById.get(t.createdByUserId) ?? null,
      dependencyTask: linked.get(t.id) ?? null,
    }));
  }

  // Task page "Dependency history" - every audited change to this task's
  // dependency tickets, oldest first, with the actor's full name. Read from
  // the audit log, so it also covers changes made before this list existed.
  async findHistoryForTask(parentTaskId: number, tenantId: number) {
    const tickets = await this.ticketsRepository.find({ where: { parentTaskId, tenantId } });
    const titleById = new Map(tickets.map((t) => [t.id, t.title]));
    const entries = await this.auditLogService.findForEntities(
      tenantId,
      'TaskDependencyTicket',
      tickets.map((t) => t.id),
      [
        AuditActions.TASK_DEPENDENCY_TICKET_CREATED,
        AuditActions.TASK_DEPENDENCY_TICKET_TITLE_UPDATED,
        AuditActions.TASK_DEPENDENCY_TICKET_OWNER_CHANGED,
        AuditActions.TASK_DEPENDENCY_TICKET_RESOLVED,
        TASK_FLAG_AUDIT.DEPENDENCY_NEED_BY_CHANGED,
      ],
    );
    const users = await this.usersService.findAll(tenantId);
    const nameById = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    const nameByEmail = new Map(users.map((u) => [u.email, u.fullName || u.email]));
    return entries.map((e) => {
      const d = (e.details || {}) as Record<string, any>;
      const ownerEmail = typeof d.ownerEmail === 'string' ? d.ownerEmail : null;
      return {
        id: e.id,
        action: e.action,
        ticketId: e.entityId,
        ticketTitle: titleById.get(e.entityId) ?? null,
        actorName: (e.userId != null && nameById.get(e.userId)) || e.userEmail,
        createdAt: e.createdAt,
        // Owner names as recorded at the time for owner changes (so a later
        // rename/deletion doesn't rewrite history); current name otherwise.
        ownerName: d.ownerName ?? (ownerEmail ? nameByEmail.get(ownerEmail) ?? ownerEmail : null),
        previousOwnerName: d.previousOwnerName ?? null,
        previousTitle: d.previousTitle ?? null,
        title: d.title ?? null,
        previousNeedByDate: d.previousNeedByDate ?? null,
        needByDate: d.needByDate ?? null,
        reason: d.reason ?? null,
      };
    });
  }

  // Dependency Clearance inbox - tickets routed to the current user to act
  // on ("Outbound": others waiting on me). Enriched with the parent
  // task's Title/Due Date so the Developer Dashboard's Outbound card can
  // compute "past due" without a second round-trip per ticket - the
  // ticket itself has no Due Date of its own.
  async findMine(ownerUserId: number, tenantId: number): Promise<TaskDependencyTicketWithParent[]> {
    const tickets = await this.ticketsRepository.find({
      where: { ownerUserId, tenantId },
      order: { createdAt: 'DESC' },
    });
    return this.withParentTaskFields(tickets, tenantId);
  }

  // Developer Dashboard "Inbound" card - tickets the current user filed
  // because they're blocked on someone else ("my dependencies on
  // others"), the mirror image of findMine() above.
  async findCreatedByMe(createdByUserId: number, tenantId: number): Promise<TaskDependencyTicketWithParent[]> {
    const tickets = await this.ticketsRepository.find({
      where: { createdByUserId, tenantId },
      order: { createdAt: 'DESC' },
    });
    return this.withParentTaskFields(tickets, tenantId);
  }

  private async withParentTaskFields(
    allTickets: TaskDependencyTicket[],
    tenantId: number,
    opts: { keepJunkParents?: boolean } = {},
  ): Promise<TaskDependencyTicketWithParent[]> {
    let tickets = allTickets;
    const parentTaskIds = [...new Set(tickets.map((t) => t.parentTaskId))];
    const parentTasks = await this.tasksService.findManyByIds(parentTaskIds, tenantId);
    const parentTaskById = new Map(parentTasks.map((t) => [t.id, t]));
    // Tickets raised on a Junk task are hidden with it (Outbound and
    // Inbound cards alike) until the task is restored.
    if (!opts.keepJunkParents) {
      tickets = tickets.filter((t) => parentTaskById.get(t.parentTaskId)?.status !== JUNK_STATUS);
    }
    const linked = await this.dependencyTaskSummaries(tickets.map((t) => t.id), tenantId);
    // One batch lookup for every filer/owner on the list - only their
    // full names leave this method, never the rest of the user row.
    const userIds = [...new Set(tickets.flatMap((t) => [t.createdByUserId, t.ownerUserId]).filter((id) => id != null))];
    const users = await this.usersService.findByIds(userIds, tenantId);
    const nameById = new Map(users.map((u) => [u.id, u.fullName || null]));
    return tickets.map((ticket) => {
      const parent = parentTaskById.get(ticket.parentTaskId);
      return {
        ...ticket,
        parentTaskTitle: parent?.title ?? null,
        parentTaskDueDate: parent?.dueDate ?? null,
        createdByName: nameById.get(ticket.createdByUserId) ?? null,
        ownerName: nameById.get(ticket.ownerUserId) ?? null,
        parentTaskStatus: parent?.status ?? null,
        parentTaskPriority: parent?.priority ?? null,
        parentTaskProjectName: parent?.projectName ?? null,
        parentTaskModuleName: parent?.moduleName ?? null,
        parentTaskPhaseName: parent?.phaseName ?? null,
        dependencyTask: linked.get(ticket.id) ?? null,
      };
    });
  }

  async create(
    dto: CreateTaskDependencyTicketDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskDependencyTicket> {
    const task = await this.tasksService.findOne(dto.parentTaskId, tenantId);
    this.tasksService.assertNotJunk(task);
    if (task.assigneeUserId !== currentUser.id) {
      throw new ForbiddenException('Only the task Assignee can create a Dependency Ticket for this task.');
    }

    const owner = await this.usersService.findByIdAndTenant(dto.ownerUserId, tenantId);
    if (!owner) {
      throw new NotFoundException(`User #${dto.ownerUserId} not found`);
    }
    if (!DEVELOPER_EQUIVALENT_ROLES.includes(owner.role)) {
      throw new BadRequestException('Dependency Owner must be a Developer, Designer, or DevOps.');
    }
    // MinLength(1) alone lets a whitespace-only title through.
    const title = dto.title.trim();
    if (!title) {
      throw new BadRequestException('Dependency Title is required.');
    }

    // Performance Tracking S3: the needed-by date.
    const trackingOn = await this.trackingOn(task.projectId, tenantId);
    if (trackingOn && !dto.needByDate) {
      throw new BadRequestException('Needed by is required - Performance Tracking is on for this project.');
    }
    if (!trackingOn && dto.needByDate) {
      throw new BadRequestException('Performance Tracking is off for this project - a dependency has no needed-by date.');
    }

    const overdueAt = dto.needByDate ? await this.overdueAtFor(dto.needByDate, tenantId) : null;
    const project = await this.projectsRepository.findOne({ where: { id: task.projectId, tenantId } });
    const withTask = !!project?.dependencyTasksEnabled;

    // Ticket and (switch on) its task are made together or not at all.
    let dependencyTaskId: number | null = null;
    const saved = await this.dataSource.transaction(async (em) => {
      const ticket = await em.save(
        TaskDependencyTicket,
        em.create(TaskDependencyTicket, {
          tenantId,
          parentTaskId: task.id,
          title,
          description: dto.description,
          ownerUserId: owner.id,
          ownerEmail: owner.email,
          createdByUserId: currentUser.id,
          createdByEmail: currentUser.email,
          needByDate: dto.needByDate ?? null,
          overdueAt,
        }),
      );
      await this.auditLogService.recordWithin(em, {
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        action: AuditActions.TASK_DEPENDENCY_TICKET_CREATED,
        tenantId,
        entityType: 'TaskDependencyTicket',
        entityId: ticket.id,
        details: { parentTaskId: ticket.parentTaskId, ownerEmail: ticket.ownerEmail, title: ticket.title, needByDate: ticket.needByDate, withTask },
      });

      if (withTask) {
        // Same project / module / phase as the parent. The owner's due date
        // starts as the needed-by date - theirs to confirm or replace (once)
        // under the normal rules; no date at all when tracking is off.
        const dependencyTask = await em.save(
          ProjectTask,
          em.create(ProjectTask, {
            tenantId,
            projectId: task.projectId,
            projectName: task.projectName,
            moduleId: task.moduleId,
            moduleName: task.moduleName,
            phaseId: task.phaseId,
            phaseName: task.phaseName,
            title,
            description: sanitizeRichText(dto.description),
            assigneeUserId: owner.id,
            assigneeEmail: owner.email,
            estimatedHours: null,
            dueDate: ticket.needByDate ?? null,
            dueDateCommittedByUserId: null,
            dueDateCommittedAt: null,
            status: 'Development',
            peerReviewEnabled: false,
            priority: task.priority ?? null,
            dependencyTicketId: ticket.id,
            createdByUserId: currentUser.id,
            createdByEmail: currentUser.email,
          }),
        );
        dependencyTaskId = dependencyTask.id;
        await this.auditLogService.recordWithin(em, {
          userId: currentUser.id,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          action: DEPENDENCY_TASK_AUDIT.TASK_CREATED,
          tenantId,
          entityType: 'ProjectTask',
          entityId: dependencyTask.id,
          details: { dependencyTicketId: ticket.id, parentTaskId: task.id, assigneeUserId: owner.id, dueDate: dependencyTask.dueDate },
        });
      }
      return ticket;
    });

    this.eventEmitter.emit('dependencyTicket.created', {
      tenantId,
      ticketId: saved.id,
      parentTaskId: saved.parentTaskId,
      title: saved.title,
      recipientUserId: saved.ownerUserId,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email,
    });

    return Object.assign(saved, { dependencyTaskId });
  }

  // Title is the only field editable after creation. Allowed for whoever
  // raised the ticket (they wrote it) or Admin/Program Manager - the same
  // "author or leadership" shape as task Title editing (confirmed with the
  // user 2026-10). The owner can't rename it - they're the one being asked
  // to act on it, not its author.
  async updateTitle(
    id: number,
    dto: UpdateTaskDependencyTicketTitleDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskDependencyTicket> {
    const ticket = await this.ticketsRepository.findOne({ where: { id, tenantId } });
    if (!ticket) {
      throw new NotFoundException(`Dependency ticket #${id} not found`);
    }
    const isCreator = ticket.createdByUserId === currentUser.id;
    const isLeadership = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.PROGRAM_MANAGER;
    if (!isCreator && !isLeadership) {
      throw new ForbiddenException('Only the person who raised this dependency, Admin, or Program Manager can edit its title.');
    }
    const title = dto.title.trim();
    if (!title) {
      throw new BadRequestException('Dependency Title is required.');
    }

    const previousTitle = ticket.title;
    ticket.title = title;
    const saved = await this.ticketsRepository.save(ticket);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_DEPENDENCY_TICKET_TITLE_UPDATED,
      tenantId,
      entityType: 'TaskDependencyTicket',
      entityId: saved.id,
      details: { parentTaskId: saved.parentTaskId, previousTitle, title: saved.title },
    });

    return saved;
  }

  // Moves an open ticket to a different owner (2026-10-14). Program
  // Manager or Admin only - the same leadership pair that may already
  // resolve or retitle any ticket. Same owner rule as create(): Developer/
  // Designer/DevOps only (never a Client - owning a ticket grants view
  // access to the internal task page, see TasksService.canView). The
  // person who filed it can't own it (they're the one blocked on it).
  // There is deliberately no "remove owner": a ticket always has one,
  // since Dependency Clearance, Team Tasks, Daily Scrum and KPI all count
  // open tickets by owner.
  async changeOwner(
    id: number,
    dto: ChangeTaskDependencyTicketOwnerDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskDependencyTicket & { ownerName: string | null }> {
    const isLeadership = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.PROGRAM_MANAGER;
    if (!isLeadership) {
      throw new ForbiddenException('Only Admin or Program Manager can change the owner of a dependency ticket.');
    }
    const ticket = await this.ticketsRepository.findOne({ where: { id, tenantId } });
    if (!ticket) {
      throw new NotFoundException(`Dependency ticket #${id} not found`);
    }
    this.tasksService.assertNotJunk(await this.tasksService.findOne(ticket.parentTaskId, tenantId));
    if (ticket.status !== 'open') {
      throw new BadRequestException('Only an open dependency ticket can change owner.');
    }
    if (dto.ownerUserId === ticket.ownerUserId) {
      throw new BadRequestException('This person is already the owner.');
    }
    if (dto.ownerUserId === ticket.createdByUserId) {
      throw new BadRequestException('The person who raised this dependency cannot own it.');
    }
    const owner = await this.usersService.findByIdAndTenant(dto.ownerUserId, tenantId);
    if (!owner) {
      throw new NotFoundException(`User #${dto.ownerUserId} not found`);
    }
    if (!DEVELOPER_EQUIVALENT_ROLES.includes(owner.role)) {
      throw new BadRequestException('Dependency Owner must be a Developer, Designer, or DevOps.');
    }

    const previousOwnerUserId = ticket.ownerUserId;
    const previousOwnerEmail = ticket.ownerEmail;
    const previousOwner = await this.usersService.findByIdAndTenant(previousOwnerUserId, tenantId);
    ticket.ownerUserId = owner.id;
    ticket.ownerEmail = owner.email;
    // A dependency task follows its ticket's owner (the only way it is
    // reassigned). Pending due-date requests are cancelled by the existing
    // trigger; the new owner gets their one free date set / confirm.
    const saved = await this.dataSource.transaction(async (em) => {
      const savedTicket = await em.save(TaskDependencyTicket, ticket);
      const dependencyTask = await this.linkedTask(em, ticket.id, tenantId);
      if (dependencyTask) {
        await em.update(ProjectTask, { id: dependencyTask.id, tenantId }, { assigneeUserId: owner.id, assigneeEmail: owner.email });
        await this.auditLogService.recordWithin(em, {
          userId: currentUser.id,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          action: DEPENDENCY_TASK_AUDIT.TASK_REASSIGNED,
          tenantId,
          entityType: 'ProjectTask',
          entityId: dependencyTask.id,
          details: { dependencyTicketId: ticket.id, previousAssigneeUserId: dependencyTask.assigneeUserId, assigneeUserId: owner.id },
        });
      }
      return savedTicket;
    });

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_DEPENDENCY_TICKET_OWNER_CHANGED,
      tenantId,
      entityType: 'TaskDependencyTicket',
      entityId: saved.id,
      details: {
        parentTaskId: saved.parentTaskId,
        previousOwnerUserId,
        previousOwnerEmail,
        previousOwnerName: previousOwner?.fullName || previousOwnerEmail,
        ownerUserId: owner.id,
        ownerEmail: owner.email,
        ownerName: owner.fullName || owner.email,
      },
    });

    this.eventEmitter.emit('dependencyTicket.ownerChanged', {
      tenantId,
      ticketId: saved.id,
      parentTaskId: saved.parentTaskId,
      title: saved.title,
      recipientUserId: owner.id,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email,
    });

    return { ...saved, ownerName: owner.fullName || null };
  }

  private async trackingOn(projectId: number, tenantId: number): Promise<boolean> {
    const project = await this.projectsRepository.findOne({ where: { id: projectId, tenantId } });
    return !!project?.performanceTrackingEnabled;
  }

  private async timeZone(tenantId: number): Promise<string> {
    const settings = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    return isValidTimeZone(settings?.timeZone) ? settings!.timeZone : TEAM_SETTINGS_DEFAULTS.timeZone;
  }

  // A needed-by date can't be in the past (in the team's time zone) - a
  // ticket filed already overdue would be charged to its owner unfairly.
  private async overdueAtFor(needByDate: string, tenantId: number): Promise<Date> {
    const timeZone = await this.timeZone(tenantId);
    if (needByDate < dateInZone(new Date(), timeZone)) {
      throw new BadRequestException('Needed by cannot be in the past.');
    }
    return needByOverdueAt(needByDate, timeZone);
  }

  // Performance Tracking S3: set or change the needed-by date of an open
  // ticket - its creator or a PM/Admin, with a reason, logged. Never the
  // owner alone (it would hide their own lateness). Also how an older,
  // undated ticket gets a date.
  async changeNeedBy(
    id: number,
    dto: ChangeNeedByDateDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskDependencyTicket> {
    const ticket = await this.ticketsRepository.findOne({ where: { id, tenantId } });
    if (!ticket) {
      throw new NotFoundException(`Dependency ticket #${id} not found`);
    }
    if (!canChangeNeedBy(ticket, currentUser)) {
      throw new ForbiddenException('Only the person who raised this dependency, Admin, or Program Manager can change its needed-by date.');
    }
    const task = await this.tasksService.findOne(ticket.parentTaskId, tenantId);
    this.tasksService.assertNotJunk(task);
    if (!(await this.trackingOn(task.projectId, tenantId))) {
      throw new BadRequestException('Performance Tracking is off for this project.');
    }
    if (ticket.status !== 'open') {
      throw new BadRequestException('Only an open dependency ticket can change its needed-by date.');
    }
    if (dto.needByDate === ticket.needByDate) {
      throw new BadRequestException('That is already the needed-by date.');
    }
    const reason = (dto.reason || '').trim();
    if (reason.length < FLAG_REASON_MIN) {
      throw new BadRequestException(`The reason must be at least ${FLAG_REASON_MIN} characters.`);
    }

    const previousNeedByDate = ticket.needByDate;
    ticket.needByDate = dto.needByDate;
    ticket.overdueAt = await this.overdueAtFor(dto.needByDate, tenantId);
    const saved = await this.ticketsRepository.save(ticket);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: TASK_FLAG_AUDIT.DEPENDENCY_NEED_BY_CHANGED,
      tenantId,
      entityType: 'TaskDependencyTicket',
      entityId: saved.id,
      details: { parentTaskId: saved.parentTaskId, previousNeedByDate, needByDate: saved.needByDate, reason },
    });

    return saved;
  }

  // Marks a ticket cleared - this entity had no resolution concept at all
  // before the KPI module needed one (see the gap analysis). Callable by
  // the ticket's own owner (the person who was blocking it - matches who
  // is expected to actually clear it) or Admin/Program Manager.
  async resolve(
    id: number,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TaskDependencyTicket> {
    const ticket = await this.ticketsRepository.findOne({ where: { id, tenantId } });
    if (!ticket) {
      throw new NotFoundException(`Dependency ticket #${id} not found`);
    }
    const isOwner = ticket.ownerUserId === currentUser.id;
    const isLeadership = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.PROGRAM_MANAGER;
    if (!isOwner && !isLeadership) {
      throw new ForbiddenException('Only the ticket owner, Admin, or Program Manager can resolve a dependency ticket.');
    }
    if (ticket.status === 'resolved') {
      throw new BadRequestException('This dependency ticket is already resolved.');
    }
    if (ticket.status === 'cancelled') {
      throw new BadRequestException('This dependency ticket was cancelled.');
    }

    // Light flow: the owner's Resolve moves a dependency task straight to
    // Pass - no QA, Peer Review or PM review (user decision 2026-11-05).
    const now = new Date();
    ticket.status = 'resolved';
    ticket.resolvedAt = now;
    const saved = await this.dataSource.transaction(async (em) => {
      const savedTicket = await em.save(TaskDependencyTicket, ticket);
      const dependencyTask = await this.linkedTask(em, ticket.id, tenantId);
      if (dependencyTask && !DEPENDENCY_TASK_RESOLVED_STATUSES.includes(dependencyTask.status)) {
        await em.update(ProjectTask, { id: dependencyTask.id, tenantId }, { status: 'Pass', completedAt: now });
        await this.auditLogService.recordWithin(em, {
          userId: currentUser.id,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          action: DEPENDENCY_TASK_AUDIT.TASK_RESOLVED,
          tenantId,
          entityType: 'ProjectTask',
          entityId: dependencyTask.id,
          details: { dependencyTicketId: ticket.id, previousStatus: dependencyTask.status, newStatus: 'Pass' },
        });
      }
      return savedTicket;
    });

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_DEPENDENCY_TICKET_RESOLVED,
      tenantId,
      entityType: 'TaskDependencyTicket',
      entityId: saved.id,
      details: { parentTaskId: saved.parentTaskId },
    });

    // Tell whoever filed the ticket their blocker is cleared.
    this.eventEmitter.emit('dependencyTicket.resolved', {
      tenantId,
      ticketId: saved.id,
      parentTaskId: saved.parentTaskId,
      title: saved.title,
      recipientUserId: saved.createdByUserId,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email,
    });

    return saved;
  }
}
