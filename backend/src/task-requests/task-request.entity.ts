import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// B4 (migrations/2026-11-performance-tracking-calendar-requests.sql) - a
// request to a named person on a task, or the owner's answer to a
// dependency ticket ('dependency': requestedAt = the ticket's filing time).
// See ./task-requests.ts.
@Entity('task_requests')
export class TaskRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column()
  projectId: number;

  @Column({ type: 'varchar', length: 12 })
  source: 'request' | 'dependency';

  @Column({ type: 'int', nullable: true })
  dependencyTicketId: number | null;

  @Column()
  requestedOfUserId: number;

  @Column()
  requestedByUserId: number;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'timestamp', default: () => 'now()' })
  requestedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  responseBody: string | null;
}
