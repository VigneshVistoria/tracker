import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export const CLIENT_REQUEST_STATUSES = ['open', 'answered'] as const;

// "Request info" - the team asking a client user for something on a
// ticket (the design's DEP-xx items / "Action needed"). Its own table
// rather than the Dependency Log, whose owners are always internal users.
@Entity('client_requests')
export class ClientRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  clientId: number;

  @Column()
  ticketId: number;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column()
  requestedByUserId: number;

  @Column()
  sentToUserId: number;

  @Column({ type: 'date', nullable: true })
  replyBy: string | null;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: string;

  @Column({ type: 'timestamp', nullable: true })
  answeredAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
