import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

  // Combined task detail view - dependency tickets filed against a given
  // parent task, with owner/filer full names for display (2026-10-14).
  async findForTask(
    parentTaskId: number,
    tenantId: number,
  ): Promise<Array<TaskDependencyTicket & { ownerName: string | null; createdByName: string | null }>> {
    const tickets = await this.ticketsRepository.find({
      where: { parentTaskId, tenantId },
      order: { createdAt: 'DESC' },
    });
    const userIds = [...new Set(tickets.flatMap((t) => [t.createdByUserId, t.ownerUserId]).filter((id) => id != null))];
    const users = await this.usersService.findByIds(userIds, tenantId);
    const nameById = new Map(users.map((u) => [u.id, u.fullName || null]));
    return tickets.map((t) => ({
      ...t,
      ownerName: nameById.get(t.ownerUserId) ?? null,
      createdByName: nameById.get(t.createdByUserId) ?? null,
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
  ): Promise<TaskDependencyTicketWithParent[]> {
    let tickets = allTickets;
    const parentTaskIds = [...new Set(tickets.map((t) => t.parentTaskId))];
    const parentTasks = await this.tasksService.findManyByIds(parentTaskIds, tenantId);
    const parentTaskById = new Map(parentTasks.map((t) => [t.id, t]));
    // Tickets raised on a Junk task are hidden with it (Outbound and
    // Inbound cards alike) until the task is restored.
    tickets = tickets.filter((t) => parentTaskById.get(t.parentTaskId)?.status !== JUNK_STATUS);
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

    const ticket = this.ticketsRepository.create({
      tenantId,
      parentTaskId: task.id,
      title,
      description: dto.description,
      ownerUserId: owner.id,
      ownerEmail: owner.email,
      createdByUserId: currentUser.id,
      createdByEmail: currentUser.email,
      needByDate: dto.needByDate ?? null,
      overdueAt: dto.needByDate ? await this.overdueAtFor(dto.needByDate, tenantId) : null,
    });
    const saved = await this.ticketsRepository.save(ticket);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_DEPENDENCY_TICKET_CREATED,
      tenantId,
      entityType: 'TaskDependencyTicket',
      entityId: saved.id,
      details: { parentTaskId: saved.parentTaskId, ownerEmail: saved.ownerEmail, title: saved.title, needByDate: saved.needByDate },
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

    return saved;
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
    const saved = await this.ticketsRepository.save(ticket);

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

    ticket.status = 'resolved';
    ticket.resolvedAt = new Date();
    const saved = await this.ticketsRepository.save(ticket);

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
