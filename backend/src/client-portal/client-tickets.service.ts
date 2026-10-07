import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, Repository } from 'typeorm';
import { Client } from './client.entity';
import { ClientTeamMember } from './client-team-member.entity';
import { ClientTicket } from './client-ticket.entity';
import { ClientTicketComment } from './client-ticket-comment.entity';
import { ClientTicketEvent } from './client-ticket-event.entity';
import { ClientTicketAttachment } from './client-ticket-attachment.entity';
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BYTES, cleanFileName, detectAttachmentType } from './attachment-types';
import { StorageService } from '../storage/storage.service';
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

export const ATTACHMENTS_BUCKET = 'client-portal-attachments';

// What arrives from the upload (multer, in memory).
export interface UploadedPortalFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

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
    @InjectRepository(ClientTicketAttachment) private attachmentsRepository: Repository<ClientTicketAttachment>,
    @InjectRepository(ProjectModule) private modulesRepository: Repository<ProjectModule>,
    @InjectRepository(User) private usersRepository: Repository<User>,
    private access: ClientAccessService,
    private dataSource: DataSource,
    private eventEmitter: EventEmitter2,
    private storage: StorageService,
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
    // Internal notes and their files are dropped in the query itself for client users.
    if (this.isClientCaller(caller)) commentWhere.isInternal = false;
    const [comments, events, files] = await Promise.all([
      this.commentsRepository.find({ where: commentWhere, order: { createdAt: 'ASC', id: 'ASC' } }),
      this.eventsRepository.find({ where: { ticketId: ticket.id, tenantId }, order: { createdAt: 'ASC', id: 'ASC' } }),
      this.attachmentsRepository.find({ where: commentWhere, order: { createdAt: 'ASC', id: 'ASC' } }),
    ]);
    const userIds = [
      ...comments.map((c) => c.authorUserId),
      ...files.map((f) => f.uploadedByUserId),
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
      files: files.map((f) => ({
        id: f.id,
        commentId: f.commentId,
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        isInternal: f.isInternal,
        uploadedByUserId: f.uploadedByUserId,
        uploadedByName: name(f.uploadedByUserId),
        createdAt: f.createdAt,
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

  // ---------- Attachments (Stage 3) ----------

  // Files on the ticket itself, or on a reply the caller just posted
  // (commentId) - those inherit the reply's internal flag. Every file is
  // checked before any is stored, so an upload is all-or-nothing.
  async addAttachments(caller: PortalCaller, tenantId: number, id: number, files: UploadedPortalFile[], commentId?: number) {
    const ticket = await this.findAccessible(caller, tenantId, id);
    const fromClient = this.isClientCaller(caller);
    if (fromClient && ticket.status === 'closed') throw new BadRequestException('This ticket is closed.');
    if (!files?.length) throw new BadRequestException('Choose at least one file.');
    if (files.length > MAX_ATTACHMENTS_PER_UPLOAD) throw new BadRequestException(`Attach at most ${MAX_ATTACHMENTS_PER_UPLOAD} files at a time.`);

    let comment: ClientTicketComment | null = null;
    if (commentId !== undefined) {
      comment = await this.commentsRepository.findOne({ where: { id: commentId, ticketId: ticket.id, tenantId } });
      // Only to your own reply - and a client can't even learn an internal note's id exists.
      if (!comment || comment.authorUserId !== caller.id) throw new NotFoundException('Reply not found');
    }

    const prepared = files.map((f) => {
      // multer reads names as latin1; browsers send UTF-8.
      const fileName = cleanFileName(Buffer.from(f.originalname || '', 'latin1').toString('utf8'));
      if (f.size > MAX_ATTACHMENT_BYTES || f.buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new BadRequestException(`${fileName} is larger than 10 MB.`);
      }
      const mimeType = detectAttachmentType(fileName, f.buffer);
      if (!mimeType) {
        throw new BadRequestException(`${fileName} is not an allowed file type (images, PDF, TXT, CSV, Word, Excel, PowerPoint).`);
      }
      return { fileName, mimeType, data: f.buffer, storageKey: `${tenantId}/${ticket.clientId}/${ticket.id}/${randomUUID()}` };
    });

    const stored: string[] = [];
    try {
      for (const p of prepared) {
        await this.storage.put(ATTACHMENTS_BUCKET, p.storageKey, p.data, p.mimeType);
        stored.push(p.storageKey);
      }
      await this.dataSource.transaction(async (manager) => {
        for (const p of prepared) {
          await manager.save(
            manager.create(ClientTicketAttachment, {
              tenantId,
              ticketId: ticket.id,
              commentId: comment?.id ?? null,
              uploadedByUserId: caller.id,
              fileName: p.fileName,
              mimeType: p.mimeType,
              sizeBytes: p.data.length,
              storageKey: p.storageKey,
              isInternal: comment?.isInternal ?? false,
            }),
          );
        }
        await manager.update(ClientTicket, { id: ticket.id, tenantId }, { lastActivityAt: new Date() });
      });
    } catch (err) {
      // Don't leave orphaned files behind if storing or saving failed part-way.
      for (const key of stored) await this.storage.remove(ATTACHMENTS_BUCKET, key).catch(() => undefined);
      throw err;
    }
    return this.get(caller, tenantId, ticket.id);
  }

  // The file, only if the caller can see its ticket - and for client users
  // only if it isn't team-only. Anything else is "not found".
  async getAttachment(caller: PortalCaller, tenantId: number, attachmentId: number) {
    const file = await this.attachmentsRepository.findOne({ where: { id: attachmentId, tenantId } });
    if (!file || (file.isInternal && this.isClientCaller(caller))) throw new NotFoundException('Not found');
    await this.findAccessible(caller, tenantId, file.ticketId);
    const data = await this.storage.get(ATTACHMENTS_BUCKET, file.storageKey);
    return { fileName: file.fileName, mimeType: file.mimeType, data };
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
