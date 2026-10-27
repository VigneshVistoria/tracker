import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TaskQaReviewAttachment } from './task-qa-review-attachment.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { TasksService } from './tasks.service';
import { StorageService } from '../storage/storage.service';
import { UserRole } from '../users/user.entity';
import {
  MAX_ATTACHMENTS_PER_TASK,
  TASK_ATTACHMENTS_BUCKET,
  UploadedTaskFile,
  prepareImageUploads,
  storeImageUploads,
} from './task-attachments.service';

// Decisions a QA can back with screenshots (approve, reject, escalate,
// not ready for testing - a retest is the same thing on a later round).
const DECIDED_STATUSES = ['approved', 'rejected', 'escalated', 'not_ready'];

// Screenshots on a QA decision (2026-10-18). The QA approves/rejects/
// escalates first, then the page uploads that decision's screenshots to
// its round - so only the QA who made that decision may attach, only to
// a decided QA round, up to the same 5 per round as a defect. Anyone who
// can view the task can view them, same as defect screenshots.
@Injectable()
export class QaReviewAttachmentsService {
  constructor(
    @InjectRepository(TaskQaReviewAttachment)
    private attachmentsRepository: Repository<TaskQaReviewAttachment>,
    @InjectRepository(TaskQaReview)
    private reviewsRepository: Repository<TaskQaReview>,
    private tasksService: TasksService,
    private storage: StorageService,
    private dataSource: DataSource,
  ) {}

  async add(currentUser: any, tenantId: number, taskId: number, reviewId: number, files: UploadedTaskFile[]) {
    const task = await this.findViewable(currentUser, tenantId, taskId);
    const round = await this.reviewsRepository.findOne({ where: { id: reviewId, taskId: task.id, tenantId } });
    if (!round) throw new NotFoundException('That review round is not on this task.');
    if (currentUser.role !== UserRole.QA || round.reviewType !== 'qa' || !DECIDED_STATUSES.includes(round.status) || round.reviewedByUserId !== currentUser.id) {
      throw new ForbiddenException('Only the QA who made this decision can attach screenshots to it.');
    }
    if (!files?.length) throw new BadRequestException('Choose at least one screenshot.');
    const existing = await this.attachmentsRepository.count({ where: { taskQaReviewId: round.id, tenantId } });
    if (existing + files.length > MAX_ATTACHMENTS_PER_TASK) {
      throw new BadRequestException(`A decision can have at most ${MAX_ATTACHMENTS_PER_TASK} screenshots.`);
    }

    const prepared = prepareImageUploads(files, `${tenantId}/${task.id}/qa-review-${round.id}`);
    await storeImageUploads(
      this.storage,
      prepared,
      async (manager) => {
        for (const p of prepared) {
          await manager.save(
            manager.create(TaskQaReviewAttachment, {
              tenantId,
              taskQaReviewId: round.id,
              taskId: task.id,
              uploadedByUserId: currentUser.id,
              fileName: p.fileName,
              mimeType: p.mimeType,
              sizeBytes: p.data.length,
              storageKey: p.storageKey,
            }),
          );
        }
      },
      this.dataSource,
    );
    return this.list(currentUser, tenantId, task.id);
  }

  // Every decision screenshot on the task, oldest first; the page groups
  // them by taskQaReviewId under each round in the review history.
  async list(currentUser: any, tenantId: number, taskId: number) {
    await this.findViewable(currentUser, tenantId, taskId);
    const rows = await this.attachmentsRepository.find({ where: { taskId, tenantId }, order: { createdAt: 'ASC', id: 'ASC' } });
    return rows.map(({ id, taskQaReviewId, fileName, mimeType, sizeBytes, uploadedByUserId, createdAt }) => ({
      id,
      taskQaReviewId,
      fileName,
      mimeType,
      sizeBytes,
      uploadedByUserId,
      createdAt,
    }));
  }

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
