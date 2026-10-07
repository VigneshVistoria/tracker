import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, Repository } from 'typeorm';
import { Client } from './client.entity';
import { ClientTeamMember } from './client-team-member.entity';
import { ClientTicket } from './client-ticket.entity';
import { ClientTicketComment } from './client-ticket-comment.entity';
import { ClientTicketEvent } from './client-ticket-event.entity';
import { ClientAccessService, PortalCaller } from './client-access.service';
import { CreateClientTicketCommentDto, CreateClientTicketDto, UpdateClientTicketDto } from './dto/client-ticket.dto';
import { ProjectModule } from '../modules/project-module.entity';
import { User, UserRole } from '../users/user.entity';

// Client-facing wording for notifications (matches the portal screens).
const CLIENT_STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  in_progress: 'In progress',
  waiting_client: 'Waiting for you',
  client_review: 'Ready for your review',
  closed: 'Closed',
};

// One recipient of a portal notification. Client users and team members
// get different links (/portal vs /client-tickets).
export interface ClientTicketNotifyEvent {
  tenantId: number;
  type: string;
  title: string;
  body: string | null;
  actorUserId: number;
  recipients: Array<{ userId: number; link: string }>;
}

// Client tickets (Stage 2): raise, read, reply, and - team only - move
// status and assign. Every method scopes through ClientAccessService
// first; anything outside the caller's clients is "not found".
//
//   Client users  raise tickets for their own company only, reply while a
//                 ticket is open, and never see internal notes.
//   Team / PM /   read and reply (optionally as an internal note), change
//   Admin         status, assign to someone on that client's team.
@Injectable()
export class ClientTicketsService {
  constructor(
    @InjectRepository(Client) private clientsRepository: Repository<Client>,
    @InjectRepository(ClientTeamMember) private teamMembersRepository: Repository<ClientTeamMember>,
    @InjectRepository(ClientTicket) private ticketsRepository: Repository<ClientTicket>,
    @InjectRepository(ClientTicketComment) private commentsRepository: Repository<ClientTicketComment>,
    @InjectRepository(ClientTicketEvent) private eventsRepository: Repository<ClientTicketEvent>,
    @InjectRepository(ProjectModule) private modulesRepository: Repository<ProjectModule>,
    @InjectRepository(User) private usersRepository: Repository<User>,
    private access: ClientAccessService,
    private dataSource: DataSource,
    private eventEmitter: EventEmitter2,
  ) {}

  private isClientCaller(caller: PortalCaller) {
    return caller.role === UserRole.CLIENT;
  }

  // ---------- Read ----------

  async list(caller: PortalCaller, tenantId: number, clientId?: number) {
    const ids = await this.access.accessibleClientIds(caller, tenantId);
    if (ids !== 'all' && ids.length === 0) return [];
    const where: Record<string, any> = ids === 'all' ? { tenantId } : { tenantId, clientId: In(ids) };
    if (clientId !== undefined) {
      if (!(await this.access.canAccessClient(caller, tenantId, clientId))) return [];
      where.clientId = clientId;
    }
    const tickets = await this.ticketsRepository.find({ where, order: { lastActivityAt: 'DESC', id: 'DESC' } });
    return this.toViews(tickets, tenantId);
  }

  async get(caller: PortalCaller, tenantId: number, id: number) {
    const ticket = await this.findAccessible(caller, tenantId, id);
    const [view] = await this.toViews([ticket], tenantId);
    const commentWhere: Record<string, any> = { ticketId: ticket.id, tenantId };
    // Internal notes are dropped in the query itself for client users.
    if (this.isClientCaller(caller)) commentWhere.isInternal = false;
    const [comments, events] = await Promise.all([
      this.commentsRepository.find({ where: commentWhere, order: { createdAt: 'ASC', id: 'ASC' } }),
      this.eventsRepository.find({ where: { ticketId: ticket.id, tenantId }, order: { createdAt: 'ASC', id: 'ASC' } }),
    ]);
    const userIds = [
      ...comments.map((c) => c.authorUserId),
      ...events.map((e) => e.actorUserId),
      ...events.filter((e) => e.type === 'assignee').flatMap((e) => [Number(e.fromValue), Number(e.toValue)]),
    ];
    const users = await this.usersById(userIds, tenantId);
    const name = (userId: number | null) => (userId ? users.get(userId)?.fullName || null : null);
    return {
      ...view,
      comments: comments.map((c) => ({
        id: c.id,
        authorUserId: c.authorUserId,
        authorName: name(c.authorUserId),
        // "Team" vs "client" side of the conversation, for the thread layout.
        fromTeam: users.get(c.authorUserId)?.role !== UserRole.CLIENT,
        body: c.body,
        isInternal: c.isInternal,
        createdAt: c.createdAt,
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        fromValue: e.type === 'assignee' ? name(Number(e.fromValue) || null) : e.fromValue,
        toValue: e.type === 'assignee' ? name(Number(e.toValue) || null) : e.toValue,
        actorName: name(e.actorUserId),
        createdAt: e.createdAt,
      })),
    };
  }

  // ---------- Write ----------

  async create(caller: PortalCaller, tenantId: number, dto: CreateClientTicketDto) {
    if (!this.isClientCaller(caller)) throw new ForbiddenException('Only client users raise portal tickets.');
    const clientId = await this.access.portalClientIdFor(caller.id, tenantId);
    if (!clientId) throw new ForbiddenException('The client portal is not available for your account.');
    const client = await this.clientsRepository.findOne({ where: { id: clientId, tenantId } });
    if (!client) throw new ForbiddenException('The client portal is not available for your account.');
    const module = await this.modulesRepository.findOne({
      where: { id: dto.moduleId, projectId: client.projectId, tenantId, isActive: true },
    });
    if (!module) throw new BadRequestException('Choose one of your modules.');
    const isBug = dto.category === 'bug';

    const saved = await this.dataSource.transaction(async (manager) => {
      // Lock the client row so two tickets submitted at the same moment
      // can't get the same number.
      await manager.query('SELECT id FROM "clients" WHERE id = $1 FOR UPDATE', [clientId]);
      const [{ next }] = await manager.query(
        'SELECT COALESCE(MAX("number"), 0) + 1 AS next FROM "client_tickets" WHERE "clientId" = $1',
        [clientId],
      );
      const ticket = await manager.save(
        manager.create(ClientTicket, {
          tenantId,
          clientId,
          projectId: client.projectId,
          moduleId: module.id,
          number: Number(next),
          category: dto.category,
          severity: dto.severity,
          priority: dto.priority,
          title: dto.title,
          description: dto.description,
          stepsToReproduce: isBug ? dto.stepsToReproduce || null : null,
          expectedResult: isBug ? dto.expectedResult || null : null,
          status: 'submitted',
          createdByUserId: caller.id,
          assigneeUserId: null,
          lastActivityAt: new Date(),
        }),
      );
      await manager.save(
        manager.create(ClientTicketEvent, { tenantId, ticketId: ticket.id, type: 'created', fromValue: null, toValue: 'submitted', actorUserId: caller.id }),
      );
      return ticket;
    });

    const team = await this.teamMembersRepository.find({ where: { clientId, tenantId } });
    this.notify(saved, caller.id, 'clientTicket.created', `New ${client.name} ticket ${this.key(client, saved)}`, saved.title, [
      ...team.filter((m) => m.getsNewTickets || m.ccAll).map((m) => this.teamLink(m.userId, saved)),
    ]);
    return this.get(caller, tenantId, saved.id);
  }

  async addComment(caller: PortalCaller, tenantId: number, id: number, dto: CreateClientTicketCommentDto) {
    const ticket = await this.findAccessible(caller, tenantId, id);
    const fromClient = this.isClientCaller(caller);
    if (fromClient && dto.isInternal) throw new ForbiddenException('Internal notes are for the team only.');
    if (fromClient && ticket.status === 'closed') throw new BadRequestException('This ticket is closed.');
    const isInternal = !fromClient && Boolean(dto.isInternal);

    await this.commentsRepository.save(
      this.commentsRepository.create({ tenantId, ticketId: ticket.id, authorUserId: caller.id, body: dto.body, isInternal }),
    );
    await this.ticketsRepository.update({ id: ticket.id, tenantId }, { lastActivityAt: new Date() });

    const client = await this.clientsRepository.findOne({ where: { id: ticket.clientId, tenantId } });
    const team = await this.teamMembersRepository.find({ where: { clientId: ticket.clientId, tenantId } });
    const key = this.key(client, ticket);
    const ccAll = team.filter((m) => m.ccAll).map((m) => this.teamLink(m.userId, ticket));
    const assignee = ticket.assigneeUserId ? [this.teamLink(ticket.assigneeUserId, ticket)] : [];
    if (isInternal) {
      // Team only - never the client.
      this.notify(ticket, caller.id, 'clientTicket.internalNote', `Internal note on ${key}`, ticket.title, [...assignee, ...ccAll]);
    } else if (fromClient) {
      const owners = assignee.length ? assignee : team.filter((m) => m.getsNewTickets).map((m) => this.teamLink(m.userId, ticket));
      this.notify(ticket, caller.id, 'clientTicket.clientReplied', `${client?.name ?? 'Client'} replied on ${key}`, ticket.title, [...owners, ...ccAll]);
    } else {
      this.notify(ticket, caller.id, 'clientTicket.teamReplied', `New reply on your ticket ${key}`, ticket.title, [
        this.portalLink(ticket.createdByUserId, ticket),
        ...assignee,
      ]);
    }
    return this.get(caller, tenantId, ticket.id);
  }

  async update(caller: PortalCaller, tenantId: number, id: number, dto: UpdateClientTicketDto) {
    const ticket = await this.findAccessible(caller, tenantId, id);
    if (this.isClientCaller(caller)) throw new ForbiddenException('Only the team can change a ticket.');
    const changes: Partial<ClientTicket> = {};
    const events: Array<Pick<ClientTicketEvent, 'type' | 'fromValue' | 'toValue'>> = [];

    if (dto.assigneeUserId !== undefined && dto.assigneeUserId !== ticket.assigneeUserId) {
      if (dto.assigneeUserId !== null) {
        const onTeam = await this.teamMembersRepository.findOne({
          where: { clientId: ticket.clientId, userId: dto.assigneeUserId, tenantId },
        });
        if (!onTeam) throw new BadRequestException("Assign the ticket to someone on this client's team.");
      }
      events.push({ type: 'assignee', fromValue: ticket.assigneeUserId ? String(ticket.assigneeUserId) : null, toValue: dto.assigneeUserId ? String(dto.assigneeUserId) : null });
      changes.assigneeUserId = dto.assigneeUserId;
    }
    if (dto.status !== undefined && dto.status !== ticket.status) {
      events.push({ type: 'status', fromValue: ticket.status, toValue: dto.status });
      changes.status = dto.status;
      changes.closedAt = dto.status === 'closed' ? new Date() : null;
    }
    if (events.length === 0) return this.get(caller, tenantId, ticket.id);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(ClientTicket, { id: ticket.id, tenantId }, { ...changes, lastActivityAt: new Date() });
      for (const e of events) {
        await manager.save(manager.create(ClientTicketEvent, { ...e, tenantId, ticketId: ticket.id, actorUserId: caller.id }));
      }
    });

    const client = await this.clientsRepository.findOne({ where: { id: ticket.clientId, tenantId } });
    const key = this.key(client, ticket);
    if (changes.assigneeUserId) {
      this.notify(ticket, caller.id, 'clientTicket.assigned', `${key} assigned to you`, ticket.title, [this.teamLink(changes.assigneeUserId, ticket)]);
    }
    if (changes.status) {
      this.notify(ticket, caller.id, 'clientTicket.statusChanged', `${key}: ${CLIENT_STATUS_LABELS[changes.status] ?? changes.status}`, ticket.title, [
        this.portalLink(ticket.createdByUserId, ticket),
      ]);
    }
    return this.get(caller, tenantId, ticket.id);
  }

  // ---------- Helpers ----------

  private async findAccessible(caller: PortalCaller, tenantId: number, id: number) {
    const ticket = await this.ticketsRepository.findOne({ where: { id, tenantId } });
    if (!ticket || !(await this.access.canAccessClient(caller, tenantId, ticket.clientId))) {
      throw new NotFoundException('Not found');
    }
    return ticket;
  }

  private key(client: Client | null, ticket: ClientTicket) {
    return `${client?.ticketPrefix ?? 'CT'}-${ticket.number}`;
  }

  private teamLink(userId: number, ticket: ClientTicket) {
    return { userId, link: `/client-tickets/${ticket.id}` };
  }

  private portalLink(userId: number, ticket: ClientTicket) {
    return { userId, link: `/portal/tickets/${ticket.id}` };
  }

  private notify(ticket: ClientTicket, actorUserId: number, type: string, title: string, body: string | null, recipients: Array<{ userId: number; link: string }>) {
    const seen = new Set<number>();
    const unique = recipients.filter((r) => r.userId && r.userId !== actorUserId && !seen.has(r.userId) && seen.add(r.userId));
    if (unique.length === 0) return;
    const event: ClientTicketNotifyEvent = { tenantId: ticket.tenantId, type, title, body, actorUserId, recipients: unique };
    this.eventEmitter.emit('clientTicket.notify', event);
  }

  private async usersById(ids: number[], tenantId: number) {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    const users = unique.length ? await this.usersRepository.find({ where: { id: In(unique), tenantId } }) : [];
    return new Map(users.map((u) => [u.id, u]));
  }

  // List/detail shape shared by client and team screens. Names only, never
  // emails, so the same shape is safe for client users.
  private async toViews(tickets: ClientTicket[], tenantId: number) {
    if (tickets.length === 0) return [];
    const clientIds = [...new Set(tickets.map((t) => t.clientId))];
    const moduleIds = [...new Set(tickets.map((t) => t.moduleId).filter((id): id is number => id != null))];
    const [clients, modules, users] = await Promise.all([
      this.clientsRepository.find({ where: { id: In(clientIds), tenantId } }),
      moduleIds.length ? this.modulesRepository.find({ where: { id: In(moduleIds), tenantId } }) : Promise.resolve([]),
      this.usersById(tickets.flatMap((t) => [t.createdByUserId, t.assigneeUserId ?? 0]), tenantId),
    ]);
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const moduleById = new Map(modules.map((m) => [m.id, m]));
    return tickets.map((t) => ({
      id: t.id,
      key: this.key(clientById.get(t.clientId) ?? null, t),
      number: t.number,
      clientId: t.clientId,
      clientName: clientById.get(t.clientId)?.name ?? null,
      projectId: t.projectId,
      moduleId: t.moduleId,
      moduleName: t.moduleId ? moduleById.get(t.moduleId)?.name ?? null : null,
      category: t.category,
      severity: t.severity,
      priority: t.priority,
      title: t.title,
      description: t.description,
      stepsToReproduce: t.stepsToReproduce,
      expectedResult: t.expectedResult,
      status: t.status,
      createdByUserId: t.createdByUserId,
      createdByName: users.get(t.createdByUserId)?.fullName || null,
      assigneeUserId: t.assigneeUserId,
      assigneeName: t.assigneeUserId ? users.get(t.assigneeUserId)?.fullName || null : null,
      closedAt: t.closedAt,
      lastActivityAt: t.lastActivityAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }
}
