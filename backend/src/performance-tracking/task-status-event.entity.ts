import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Performance Tracking S1 (2026-10-28, migrations/2026-10-performance-
// tracking-foundation.sql). One row per task status change: from, to, when
// and who. Written by DATABASE TRIGGERS, not by this app - a trigger on
// project_tasks records every insert and status change whatever code path
// made it, and the actor comes from the audit entry of the action that
// changed it (see the migration; the action list is STATUS_EVENT_AUDIT_
// ACTIONS in ./performance-tracking.ts). The app only reads this table.
// History before the migration is rebuilt from audit_logs ('reconstructed').
// Rows are never updated after linking, nor deleted.
@Entity('task_status_events')
export class TaskStatusEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  // Null for the creation event.
  @Column({ type: 'varchar', length: 40, nullable: true })
  fromStatus: string | null;

  @Column({ type: 'varchar', length: 40 })
  toStatus: string;

  @Column({ type: 'timestamp' })
  occurredAt: Date;

  // Null = a system change (no status audit entry from a person).
  @Column({ type: 'int', nullable: true })
  actorUserId: number | null;

  @Column({ type: 'varchar', nullable: true })
  actorRole: string | null;

  // The audit action that made the change, when linked.
  @Column({ type: 'varchar', length: 60, nullable: true })
  action: string | null;

  // Unique when set.
  @Column({ type: 'int', nullable: true })
  auditLogId: number | null;

  @Column({ type: 'varchar', length: 20 })
  source: 'live' | 'reconstructed';

  @CreateDateColumn()
  recordedAt: Date;
}
