import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// A file on a client ticket (Stage 3). The bytes live in StorageService
// under storageKey (random, never the uploaded name). isInternal copies
// the internal-note flag of the reply it came with: team-only, never
// listed or downloadable for client users. Kept for as long as the
// ticket; no deleting (decided with the user 2026-10-07).
@Entity('client_ticket_attachments')
export class ClientTicketAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  ticketId: number;

  @Column({ type: 'int', nullable: true })
  commentId: number | null;

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

  @Column({ default: false })
  isInternal: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
