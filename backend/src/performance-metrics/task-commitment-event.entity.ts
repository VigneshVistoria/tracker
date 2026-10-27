import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Performance metrics Stage 1 (2026-10-27, migrations/2026-10-performance-
// metrics.sql). One row per assignment or Due date event on a task, made
// from the audit entry that recorded it (commitmentEventFromAudit() in
// ./commitment-events.ts): written live by AuditLogService, and for the
// history before that by the backfill script, which marks its rows
// 'reconstructed'. Raw facts only - what counts as on time or as a change
// is decided at report time (./performance-metrics.compute.ts) from the
// editable settings. Rows are never updated or deleted.
export type CommitmentEventKind = 'assigned' | 'unassigned' | 'due_set' | 'due_changed' | 'due_cleared';

@Entity('task_commitment_events')
export class TaskCommitmentEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column({ type: 'varchar', length: 20 })
  kind: CommitmentEventKind;

  // 'assigned': the new assignee. 'unassigned': null. Due date events: the
  // assignee at the time of the edit (from the task as it was).
  @Column({ type: 'int', nullable: true })
  assigneeUserId: number | null;

  // Only known for a reassignment (the audit entry carries it).
  @Column({ type: 'int', nullable: true })
  previousAssigneeUserId: number | null;

  // Who did it - null for a system action.
  @Column({ type: 'int', nullable: true })
  actorUserId: number | null;

  @Column({ type: 'varchar', nullable: true })
  actorRole: string | null;

  // The audit entry's own time.
  @Column({ type: 'timestamp' })
  occurredAt: Date;

  @Column({ type: 'date', nullable: true })
  oldDueDate: string | null;

  @Column({ type: 'date', nullable: true })
  newDueDate: string | null;

  // 'due_changed' only: 'later' (an extension) or 'earlier'.
  @Column({ type: 'varchar', length: 10, nullable: true })
  direction: 'later' | 'earlier' | null;

  // 'live' = written as it happened; 'reconstructed' = backfilled from
  // the audit log afterwards.
  @Column({ type: 'varchar', length: 20 })
  source: 'live' | 'reconstructed';

  // Unique - the backfill can be re-run without duplicating anything.
  @Column({ unique: true })
  auditLogId: number;

  @CreateDateColumn()
  recordedAt: Date;
}
