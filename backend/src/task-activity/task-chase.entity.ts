import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// Performance Tracking B1 (2026-10-30, migrations/2026-11-performance-
// tracking-chase-notes.sql) - one row per Chase, kept forever. See
// ./task-activity.ts.
@Entity('task_chases')
export class TaskChase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column()
  projectId: number;

  // Who was chased: the task's assignee at that moment (O3).
  @Column()
  assigneeUserId: number;

  @Column()
  chasedByUserId: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 60 })
  taskStatus: string;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;
}
