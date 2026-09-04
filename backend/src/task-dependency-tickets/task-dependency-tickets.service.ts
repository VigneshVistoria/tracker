import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskDependencyTicket } from './task-dependency-ticket.entity';
import { CreateTaskDependencyTicketDto } from './dto/create-task-dependency-ticket.dto';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface TaskDependencyTicketWithParent extends TaskDependencyTicket {
  parentTaskDescription: string | null;
  parentTaskDueDate: string | null;
}

@Injectable()
export class TaskDependencyTicketsService {
  constructor(
    @InjectRepository(TaskDependencyTicket)
    private ticketsRepository: Repository<TaskDependencyTicket>,
    private tasksService: TasksService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
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
  // task's Description/Due Date so the Developer Dashboard's Outbound
  // card can compute "past due" without a second round-trip per ticket -
  // the ticket itself has no Due Date of its own.
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
    return tickets.map((ticket) => ({
      ...ticket,
      parentTaskDescription: parentTaskById.get(ticket.parentTaskId)?.description ?? null,
      parentTaskDueDate: parentTaskById.get(ticket.parentTaskId)?.dueDate ?? null,
    }));
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
    if (owner.role !== UserRole.DEVELOPER) {
      throw new BadRequestException('Dependency Owner must be a Developer.');
    }

    const ticket = this.ticketsRepository.create({
      tenantId,
      parentTaskId: task.id,
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
      details: { parentTaskId: saved.parentTaskId, ownerEmail: saved.ownerEmail },
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

    return saved;
  }
}
