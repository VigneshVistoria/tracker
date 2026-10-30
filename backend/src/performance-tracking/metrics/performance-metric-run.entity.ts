import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// Performance Tracking B2 (2026-10-30, migrations/2026-11-performance-
// tracking-metrics.sql) - one row per metrics run, nightly or "Recalculate
// now". 'skipped' = another run for the tenant was still going.
@Entity('performance_metric_runs')
export class PerformanceMetricRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'date' })
  snapshotDate: string;

  @Column({ type: 'varchar', length: 10 })
  trigger: 'nightly' | 'manual';

  @Column({ type: 'int', nullable: true })
  triggeredByUserId: number | null;

  @Column({ type: 'varchar', length: 10 })
  status: 'running' | 'done' | 'failed' | 'skipped';

  @Column({ type: 'int', default: 0 })
  projects: number;

  @Column({ type: 'int', default: 0 })
  rowsWritten: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
