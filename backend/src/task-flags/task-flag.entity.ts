import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { TaskFlagKind } from './task-flags';

// Performance Tracking S3 (2026-10-28, migrations/2026-10-performance-
// tracking-flags.sql) - one row per risk or blocker flag, kept after it is
// cleared. See ./task-flags.ts for the rules.
@Entity('task_flags')
export class TaskFlag {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column()
  projectId: number;

  @Column({ type: 'varchar', length: 10 })
  kind: TaskFlagKind;

  @Column({ type: 'text' })
  reason: string;

  // Risk only, for information - never changes the committed Due date.
  @Column({ type: 'date', nullable: true })
  likelyDueDate: string | null;

  // Blocker only: a tracker user, or an outside party as text (external).
  @Column({ type: 'int', nullable: true })
  blockingOwnerUserId: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  blockingOwnerExternal: string | null;

  @Column({ default: false })
  external: boolean;

  // Blocker only, optional: one of the task's dependency tickets.
  @Column({ type: 'int', nullable: true })
  dependencyTicketId: number | null;

  // The task's assignee and Due date when the flag went up.
  @Column({ type: 'int', nullable: true })
  assigneeUserId: number | null;

  @Column({ type: 'date', nullable: true })
  committedDueDateAtSet: string | null;

  @Column()
  setByUserId: number;

  // Only flags the assignee set count for D3 and O1.
  @Column()
  setByAssignee: boolean;

  @Column({ type: 'timestamp', default: () => 'now()' })
  setAt: Date;

  @Column({ type: 'int', nullable: true })
  clearedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  clearedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  clearNote: string | null;

  // 'manual', or 'status:<status>' (database trigger).
  @Column({ type: 'varchar', length: 60, nullable: true })
  clearReason: string | null;
}
