import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export const CLIENT_TICKET_EVENT_TYPES = ['created', 'status', 'assignee'] as const;

// Status history of a client ticket (Stage 2): one row when it's created
// and one per status or assignee change. Drives the ticket's timeline and,
// later, SLA tracking and service reports. For 'assignee' rows the values
// are user ids as text.
@Entity('client_ticket_events')
export class ClientTicketEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  ticketId: number;

  @Column({ type: 'varchar', length: 20 })
  type: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  fromValue: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  toValue: string | null;

  @Column()
  actorUserId: number;

  @CreateDateColumn()
  createdAt: Date;
}
