import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// A screenshot QA attached to a defect (pasted or screen-captured on
// Create Defect). Same shape and storage as ClientTicketAttachment: the
// bytes live in StorageService under storageKey (random, never the
// uploaded name) and are only ever served back through the backend after
// the task's own view check.
@Entity('task_attachments')
export class TaskAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column()
  uploadedByUserId: number;

  // Cleaned original name, for display and the download filename only.
  @Column({ length: 200 })
  fileName: string;

  // Detected from the file's content, never taken from the upload.
  @Column({ length: 100 })
  mimeType: string;

  @Column()
  sizeBytes: number;

  @Column({ length: 300 })
  storageKey: string;

  @CreateDateColumn()
  createdAt: Date;
}
