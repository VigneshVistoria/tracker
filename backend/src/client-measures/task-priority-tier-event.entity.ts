import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Performance Tracking L3 (migrations/2026-11-performance-tracking-client-
// measures.sql) - every change of a task's client priority tier, so each
// submission is judged by the tier at that moment. Never deleted. See
// ./client-measures.ts.
@Entity('task_priority_tier_events')
export class TaskPriorityTierEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  taskId: number;

  // null = cleared.
  @Column({ type: 'smallint', nullable: true })
  tier: number | null;

  @Column({ type: 'smallint', nullable: true })
  previousTier: number | null;

  @Column()
  changedByUserId: number;

  @CreateDateColumn()
  changedAt: Date;
}
