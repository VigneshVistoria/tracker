import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Performance Tracking L4 (migrations/2026-11-performance-tracking-client-
// measures.sql) - one UAT round of a task. Never deleted. See ./client-measures.ts.
@Entity('task_uat_results')
export class TaskUatResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  taskId: number;

  @Column()
  round: number;

  @Column({ type: 'varchar', length: 10 })
  result: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column()
  recordedByUserId: number;

  @CreateDateColumn()
  recordedAt: Date;
}
