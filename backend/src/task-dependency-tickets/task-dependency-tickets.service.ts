import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskDependencyTicket } from './task-dependency-ticket.entity';
import { CreateTaskDependencyTicketDto } from './dto/create-task-dependency-ticket.dto';
import { UpdateTaskDependencyTicketTitleDto } from './dto/update-task-dependency-ticket-title.dto';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

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
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
  ) {}

  // Combined task detail view - dependency tickets filed against a given
  // parent task.
  findForTask(parentTaskId: number, tenantId: number): Promise<TaskDependencyTicket[]> {
    return this.ticketsRepository.find({
      where: { parentTaskId, tenantId },
      order: { createdAt: 'DESC' },
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
    tickets: TaskDependencyTicket[],
    tenantId: number,
  ): Promise<TaskDependencyTicketWithParent[]> {
    const parentTaskIds = [...new Set(tickets.map((t) => t.parentTaskId))];
    const parentTasks = await this.tasksService.findManyByIds(parentTaskIds, tenantId);
    const parentTaskById = new Map(parentTasks.map((t) => [t.id, t]));
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

    const ticket = this.ticketsRepository.create({
      tenantId,
      parentTaskId: task.id,
      title,
      description: dto.description,
      ownerUserId: owner.id,
      ownerEmail: owner.email,
      createdByUserId: currentUser.id,
      createdByEmail: currentUser.email,
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
      details: { parentTaskId: saved.parentTaskId, ownerEmail: saved.ownerEmail, title: saved.title },
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
