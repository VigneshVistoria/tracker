import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// Performance Tracking B3 (2026-10-30, migrations/2026-11-performance-
// tracking-scorecard.sql) - a Technical Director override of one person's
// score on one metric, from `effectiveFrom` on, until removed. Never
// deleted; the computed score at the time is kept. See ./scoring.ts.
@Entity('performance_score_overrides')
export class PerformanceScoreOverride {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  userId: number;

  @Column({ type: 'varchar', length: 10 })
  metric: string;

  @Column({ type: 'date' })
  effectiveFrom: string;

  @Column({ type: 'int', nullable: true })
  originalScore: number | null;

  @Column({ type: 'int' })
  overrideScore: number;

  @Column({ type: 'text' })
  reason: string;

  @Column()
  createdByUserId: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'int', nullable: true })
  removedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  removedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  removeReason: string | null;
}
