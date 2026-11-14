import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { cleanFileName, detectAttachmentType } from '../client-portal/attachment-types';
import { PreparedImageUpload, UploadedTaskFile } from '../tasks/task-attachments.service';
import { TaskDependencyTicketAttachment } from './task-dependency-ticket-attachment.entity';
import {
  DEPENDENCY_ATTACHMENT_MAX_BYTES,
  DEPENDENCY_ATTACHMENT_MIME_TYPES,
  DEPENDENCY_ATTACHMENT_TYPES_LABEL,
  DependencyAttachmentSide,
} from './dependency-attachments';

// Checks every file before anything is stored (allowed types only, by
// content; 10 MB each) - the client portal's checks with a narrower list.
// Throws a 400 naming the first bad file. Stored under a random key in
// the existing private bucket, never the uploaded name.
export function prepareDependencyUploads(files: UploadedTaskFile[], tenantId: number, ticketId: number): PreparedImageUpload[] {
  return files.map((f) => {
    // multer reads names as latin1; browsers send UTF-8.
    const fileName = cleanFileName(Buffer.from(f.originalname || '', 'latin1').toString('utf8'));
    if (f.size > DEPENDENCY_ATTACHMENT_MAX_BYTES || f.buffer.length > DEPENDENCY_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(`${fileName} is larger than 10 MB.`);
    }
    const mimeType = detectAttachmentType(fileName, f.buffer);
    if (!mimeType || !DEPENDENCY_ATTACHMENT_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(`${fileName} is not an allowed file type - ${DEPENDENCY_ATTACHMENT_TYPES_LABEL} only.`);
    }
    return { fileName, mimeType, data: f.buffer, storageKey: `dependency-tickets/${tenantId}/${ticketId}/${randomUUID()}` };
  });
}

// One row per file, in upload order, inside the caller's transaction.
export async function dependencyAttachmentRows(
  em: EntityManager,
  prepared: PreparedImageUpload[],
  base: { tenantId: number; ticketId: number; side: DependencyAttachmentSide; uploadedByUserId: number },
): Promise<TaskDependencyTicketAttachment[]> {
  const rows: TaskDependencyTicketAttachment[] = [];
  for (const p of prepared) {
    rows.push(
      await em.save(
        em.create(TaskDependencyTicketAttachment, {
          ...base,
          fileName: p.fileName,
          mimeType: p.mimeType,
          sizeBytes: p.data.length,
          storageKey: p.storageKey,
        }),
      ),
    );
  }
  return rows;
}
