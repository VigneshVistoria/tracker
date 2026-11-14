import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TaskDependencyTicket } from './task-dependency-ticket.entity';
import { TaskDependencyTicketAttachment } from './task-dependency-ticket-attachment.entity';
import { TaskDependencyTicketsService } from './task-dependency-tickets.service';
import { StorageService } from '../storage/storage.service';
import { AuditLogService } from '../audit/audit-log.service';
import { TASK_ATTACHMENTS_BUCKET, UploadedTaskFile, storeImageUploads } from '../tasks/task-attachments.service';
import {
  DEPENDENCY_ATTACHMENT_AUDIT,
  DEPENDENCY_ATTACHMENT_SIDES,
  DEPENDENCY_ATTACHMENTS_PER_SIDE,
  DependencyAttachmentSide,
  dependencyAttachmentBlock,
} from './dependency-attachments';
import { dependencyAttachmentRows, prepareDependencyUploads } from './dependency-attachment-uploads';

// Dependency attachments (2026-11-13) - adding, listing and downloading
// files on a dependency ticket. See ./dependency-attachments.ts. Resolve
// with files lives in TaskDependencyTicketsService.resolve().
@Injectable()
export class TaskDependencyTicketAttachmentsService {
  constructor(
    @InjectRepository(TaskDependencyTicketAttachment)
    private attachmentsRepository: Repository<TaskDependencyTicketAttachment>,
    @InjectRepository(TaskDependencyTicket)
    private ticketsRepository: Repository<TaskDependencyTicket>,
    private ticketsService: TaskDependencyTicketsService,
    private storage: StorageService,
    private auditLogService: AuditLogService,
    private dataSource: DataSource,
  ) {}

  // Every file is checked before any is stored - all-or-nothing.
  async add(currentUser: any, tenantId: number, ticketId: number, side: string, files: UploadedTaskFile[]) {
    if (!DEPENDENCY_ATTACHMENT_SIDES.includes(side as DependencyAttachmentSide)) {
      throw new BadRequestException("side must be 'request' or 'resolution'.");
    }
    const s = side as DependencyAttachmentSide;
    // Same visibility as the ticket itself (404/403 first).
    await this.ticketsService.findOneForViewer(ticketId, currentUser, tenantId);
    const ticket = await this.ticketsRepository.findOneOrFail({ where: { id: ticketId, tenantId } });
    if (!(await this.ticketsService.attachmentsEnabledForTask(ticket.parentTaskId, tenantId))) {
      throw new BadRequestException('Dependency attachments are off for this project.');
    }
    const block = dependencyAttachmentBlock(ticket, s, currentUser);
    if (block) throw new ForbiddenException(block);
    if (!files?.length) throw new BadRequestException('Choose at least one file.');
    const existing = await this.attachmentsRepository.count({ where: { ticketId, tenantId, side: s } });
    if (existing + files.length > DEPENDENCY_ATTACHMENTS_PER_SIDE) {
      throw new BadRequestException(`A dependency can have at most ${DEPENDENCY_ATTACHMENTS_PER_SIDE} ${s} files (${existing} already).`);
    }
    const prepared = prepareDependencyUploads(files, tenantId, ticketId);
    await storeImageUploads(
      this.storage,
      prepared,
      async (em) => {
        // Still in the state the check above saw (a Resolve, Reopen or
        // Cancel at the same moment refuses the upload).
        const now = await em.findOne(TaskDependencyTicket, { where: { id: ticketId, tenantId }, lock: { mode: 'pessimistic_write' } });
        const lateBlock = now ? dependencyAttachmentBlock(now, s, currentUser) : 'This dependency ticket no longer exists.';
        if (lateBlock) throw new BadRequestException(lateBlock);
        const rows = await dependencyAttachmentRows(em, prepared, { tenantId, ticketId, side: s, uploadedByUserId: currentUser.id });
        await this.auditLogService.recordWithin(em, {
          userId: currentUser.id,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          action: DEPENDENCY_ATTACHMENT_AUDIT.FILES_ATTACHED,
          tenantId,
          entityType: 'TaskDependencyTicket',
          entityId: ticketId,
          details: { parentTaskId: ticket.parentTaskId, side: s, files: rows.map((r) => ({ id: r.id, fileName: r.fileName, sizeBytes: r.sizeBytes })) },
        });
      },
      this.dataSource,
    );
    return this.list(currentUser, tenantId, ticketId);
  }

  // Both sides, oldest first, with the uploader's name. Files stay visible
  // even if the switch is later turned off.
  async list(currentUser: any, tenantId: number, ticketId: number) {
    await this.ticketsService.findOneForViewer(ticketId, currentUser, tenantId);
    const rows: any[] = await this.dataSource.query(
      `SELECT a.id, a.side, a."fileName", a."mimeType", a."sizeBytes", a."uploadedByUserId", COALESCE(NULLIF(u."fullName", ''), u.email) AS "uploadedByName", a."createdAt"
         FROM task_dependency_ticket_attachments a
         LEFT JOIN users u ON u.id = a."uploadedByUserId"
        WHERE a."tenantId" = $1 AND a."ticketId" = $2
        ORDER BY a."createdAt" ASC, a.id ASC`,
      [tenantId, ticketId],
    );
    return rows.map((r) => ({ ...r, uploadedByName: r.uploadedByName ?? null }));
  }

  // The file, only if the caller can see its ticket - otherwise 404/403,
  // same as the ticket.
  async get(currentUser: any, tenantId: number, attachmentId: number) {
    const file = await this.attachmentsRepository.findOne({ where: { id: attachmentId, tenantId } });
    if (!file) throw new NotFoundException('Not found');
    await this.ticketsService.findOneForViewer(file.ticketId, currentUser, tenantId);
    const data = await this.storage.get(TASK_ATTACHMENTS_BUCKET, file.storageKey);
    return { fileName: file.fileName, mimeType: file.mimeType, data };
  }
}
