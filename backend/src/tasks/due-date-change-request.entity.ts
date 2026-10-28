import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { DueDateRequestKind, DueDateRequestStatus } from './due-date-change';

// Performance Tracking S2 (2026-10-28, migrations/2026-10-performance-
// tracking-due-date-commitment.sql) - one row per change to a committed
// Due date while tracking is ON: an assignee's request, or a PM/Admin
// direct change ('direct', approved at once). See ./due-date-change.ts.
@Entity('due_date_change_requests')
export class DueDateChangeRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column()
  projectId: number;

  @Column({ type: 'varchar', length: 10 })
  kind: DueDateRequestKind;

  // The task's assignee when the row was made.
  @Column({ type: 'int', nullable: true })
  assigneeUserId: number | null;

  @Column()
  requestedByUserId: number;

  @Column({ type: 'date' })
  currentDueDate: string;

  @Column({ type: 'date' })
  requestedDueDate: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'varchar', length: 20 })
  status: DueDateRequestStatus;

  @Column({ type: 'int', nullable: true })
  decidedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionNote: string | null;

  // 'reassigned', 'status:<status>' (database trigger) or 'superseded' (a
  // PM/Admin changed the date directly).
  @Column({ type: 'varchar', length: 60, nullable: true })
  cancelReason: string | null;

  // The TASK_UPDATED audit entry that applied the change (its
  // task_commitment_events row has the same auditLogId).
  @Column({ type: 'int', nullable: true })
  auditLogId: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
