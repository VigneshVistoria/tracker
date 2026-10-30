import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// Performance Tracking B1 (2026-10-30, migrations/2026-11-performance-
// tracking-chase-notes.sql) - one row per progress note by the assignee,
// kept forever. C5 counts these with status changes. See ./task-activity.ts.
@Entity('task_progress_notes')
export class TaskProgressNote {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column()
  projectId: number;

  @Column()
  authorUserId: number;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'varchar', length: 60 })
  taskStatus: string;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;
}
