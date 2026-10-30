import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// Performance Tracking B2 (2026-10-30, migrations/2026-11-performance-
// tracking-metrics.sql) - one row per (night, project, person, metric).
// A re-run for the same night replaces that night's rows for the project.
// See ./tracking-metrics.ts for what each metric means.
@Entity('performance_metric_snapshots')
export class PerformanceMetricSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'date' })
  snapshotDate: string;

  @Column()
  projectId: number;

  @Column()
  userId: number;

  @Column({ type: 'varchar', length: 10 })
  metric: string;

  // 'baseline' for the first baselineDays after go-live, then 'scoring'.
  @Column({ type: 'varchar', length: 10 })
  phase: 'baseline' | 'scoring';

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  value: string | null;

  @Column({ type: 'int', nullable: true })
  numerator: number | null;

  @Column({ type: 'int', nullable: true })
  denominator: number | null;

  @Column({ type: 'int' })
  sample: number;

  @Column()
  enoughData: boolean;

  // First day the metric looked at (the rolling window, never before go-live).
  @Column({ type: 'date' })
  windowFrom: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  details: Record<string, unknown>;

  @Column()
  runId: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  computedAt: Date;
}
