import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Values from the approved design (client-portal-v3.html).
export const CLIENT_TICKET_CATEGORIES = ['bug', 'change_request', 'question', 'support'] as const;
export const CLIENT_TICKET_SEVERITIES = ['showstopper', 'critical', 'major', 'minor'] as const;
export const CLIENT_TICKET_PRIORITIES = ['low', 'medium', 'high'] as const;
// submitted -> in_progress -> (waiting_client <-> in_progress) ->
// client_review -> closed, or back to in_progress on "send back".
export const CLIENT_TICKET_STATUSES = ['submitted', 'in_progress', 'waiting_client', 'client_review', 'closed'] as const;

// A ticket a client raised through the portal. Its own table rather than
// `issues`, so the portal's lifecycle never touches the existing issue
// workflow (confirmed with the user 2026-10-07). Stage 1 holds the core
// fields only; SLA, rating, attachments etc. arrive in later stages as
// additive migrations.
@Entity('client_tickets')
export class ClientTicket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  clientId: number;

  @Column()
  projectId: number;

  @Column({ type: 'int', nullable: true })
  moduleId: number | null;

  // Per-client running number shown to the client (unique per client).
  @Column()
  number: number;

  @Column({ type: 'varchar', length: 30 })
  category: string;

  @Column({ type: 'varchar', length: 20 })
  severity: string;

  @Column({ type: 'varchar', length: 10 })
  priority: string;

  @Column({ length: 120 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 20, default: 'submitted' })
  status: string;

  @Column()
  createdByUserId: number;

  @Column({ type: 'int', nullable: true })
  assigneeUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
