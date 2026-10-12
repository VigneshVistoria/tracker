import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TaskAttachment } from './task-attachment.entity';
import { TasksService } from './tasks.service';
import { StorageService } from '../storage/storage.service';
import {
  INLINE_MIME_TYPES,
  MAX_ATTACHMENTS_PER_UPLOAD,
  MAX_ATTACHMENT_BYTES,
  cleanFileName,
  detectAttachmentType,
} from '../client-portal/attachment-types';
import { UserRole } from '../users/user.entity';

export const TASK_ATTACHMENTS_BUCKET = 'task-attachments';
// Screenshots per defect, in total - same number as one portal upload.
export const MAX_ATTACHMENTS_PER_TASK = MAX_ATTACHMENTS_PER_UPLOAD;

export interface UploadedTaskFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

// Defect screenshots - reuses the client portal's pipeline as-is (private
// StorageService bucket, content-based type check, 10 MB limit, backend-
// only downloads), with images only. Uploading is limited to the QA user
// who filed the defect; anyone who can view the task can view its files.
@Injectable()
export class TaskAttachmentsService {
  constructor(
    @InjectRepository(TaskAttachment)
    private attachmentsRepository: Repository<TaskAttachment>,
    private tasksService: TasksService,
    private storage: StorageService,
    private dataSource: DataSource,
  ) {}

  // Every file is checked before any is stored, so an upload is
  // all-or-nothing.
  async add(currentUser: any, tenantId: number, taskId: number, files: UploadedTaskFile[]) {
    // Must still be able to view it (e.g. not once it's Junk) - checked
    // before anything is stored.
    const task = await this.findViewable(currentUser, tenantId, taskId);
    if (!task.isDefect || currentUser.role !== UserRole.QA || task.createdByUserId !== currentUser.id) {
      throw new ForbiddenException('Only the QA user who filed this defect can attach screenshots to it.');
    }
    if (!files?.length) throw new BadRequestException('Choose at least one screenshot.');
    const existing = await this.attachmentsRepository.count({ where: { taskId: task.id, tenantId } });
    if (existing + files.length > MAX_ATTACHMENTS_PER_TASK) {
      throw new BadRequestException(`A defect can have at most ${MAX_ATTACHMENTS_PER_TASK} screenshots.`);
    }

    const prepared = files.map((f) => {
      // multer reads names as latin1; browsers send UTF-8.
      const fileName = cleanFileName(Buffer.from(f.originalname || '', 'latin1').toString('utf8'));
      if (f.size > MAX_ATTACHMENT_BYTES || f.buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new BadRequestException(`${fileName} is larger than 10 MB.`);
      }
      const mimeType = detectAttachmentType(fileName, f.buffer);
      if (!mimeType || !INLINE_MIME_TYPES.includes(mimeType)) {
        throw new BadRequestException(`${fileName} is not an allowed image type (PNG, JPEG, WebP or GIF).`);
      }
      return { fileName, mimeType, data: f.buffer, storageKey: `${tenantId}/${task.id}/${randomUUID()}` };
    });

    const stored: string[] = [];
    try {
      for (const p of prepared) {
        await this.storage.put(TASK_ATTACHMENTS_BUCKET, p.storageKey, p.data, p.mimeType);
        stored.push(p.storageKey);
      }
      await this.dataSource.transaction(async (manager) => {
        for (const p of prepared) {
          await manager.save(
            manager.create(TaskAttachment, {
              tenantId,
              taskId: task.id,
              uploadedByUserId: currentUser.id,
              fileName: p.fileName,
              mimeType: p.mimeType,
              sizeBytes: p.data.length,
              storageKey: p.storageKey,
            }),
          );
        }
      });
    } catch (err) {
      // Don't leave orphaned files behind if storing or saving failed part-way.
      for (const key of stored) await this.storage.remove(TASK_ATTACHMENTS_BUCKET, key).catch(() => undefined);
      throw err;
    }
    return this.list(currentUser, tenantId, task.id);
  }

  async list(currentUser: any, tenantId: number, taskId: number) {
    await this.findViewable(currentUser, tenantId, taskId);
    const rows = await this.attachmentsRepository.find({ where: { taskId, tenantId }, order: { createdAt: 'ASC', id: 'ASC' } });
    return rows.map(({ id, fileName, mimeType, sizeBytes, uploadedByUserId, createdAt }) => ({
      id,
      fileName,
      mimeType,
      sizeBytes,
      uploadedByUserId,
      createdAt,
    }));
  }

  // The file, only if the caller can view its task - anything else is
  // "not found" / forbidden, same as the task itself.
  async get(currentUser: any, tenantId: number, attachmentId: number) {
    const file = await this.attachmentsRepository.findOne({ where: { id: attachmentId, tenantId } });
    if (!file) throw new NotFoundException('Not found');
    await this.findViewable(currentUser, tenantId, file.taskId);
    const data = await this.storage.get(TASK_ATTACHMENTS_BUCKET, file.storageKey);
    return { fileName: file.fileName, mimeType: file.mimeType, data };
  }

  private async findViewable(currentUser: any, tenantId: number, taskId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (!(await this.tasksService.canView(task, currentUser))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return task;
  }
}
