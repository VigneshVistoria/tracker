import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// A reply on a client ticket (Stage 2). isInternal = a team-only note:
// ClientTicketsService strips these for client users in every response
// and notification, so they never leave the team.
@Entity('client_ticket_comments')
export class ClientTicketComment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  ticketId: number;

  @Column()
  authorUserId: number;

  @Column({ type: 'text' })
  body: string;

  @Column({ default: false })
  isInternal: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
