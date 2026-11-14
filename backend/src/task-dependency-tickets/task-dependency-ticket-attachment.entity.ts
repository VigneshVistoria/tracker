import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Dependency attachments (2026-11-13, migrations/2026-11-dependency-
// attachments.sql): a file on a dependency ticket - attached by the
// requester when raising ('request') or by whoever resolved it
// ('resolution'). Same shape and storage as TaskAttachment: the bytes live
// in StorageService under storageKey (random, never the uploaded name) and
// are only served back through the backend after the ticket's view check.
@Entity('task_dependency_ticket_attachments')
export class TaskDependencyTicketAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  ticketId: number;

  @Column({ type: 'varchar', length: 20 })
  side: 'request' | 'resolution';

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
