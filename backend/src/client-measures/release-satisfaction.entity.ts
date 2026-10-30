import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Performance Tracking L5 (migrations/2026-11-performance-tracking-client-
// measures.sql) - the client's answers for one release (one per release).
// `questions` keeps the wording answered. See ./client-measures.ts.
@Entity('release_satisfaction')
export class ReleaseSatisfaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  releaseId: number;

  @Column({ type: 'jsonb' })
  questions: string[];

  @Column({ type: 'jsonb' })
  scores: number[];

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  average: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  respondent: string | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column()
  recordedByUserId: number;

  @CreateDateColumn()
  recordedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
