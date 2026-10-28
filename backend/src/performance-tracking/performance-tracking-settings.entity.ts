import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Performance Tracking thresholds (2026-10-28) - one row per tenant, edited
// by Admin and Program Manager. A tenant with no row uses
// PERFORMANCE_TRACKING_DEFAULTS (./performance-tracking.ts); nothing is
// written until someone saves, and every save is audited. Time zone,
// weekend days, holidays, the rolling window, the minimum sample and the
// "Due date by end of next working day" rule are NOT repeated here - they
// stay on performance_metric_settings and are shared.
@Entity('performance_tracking_settings')
export class PerformanceTrackingSettings {
  @PrimaryColumn()
  tenantId: number;

  // A project shows "Baseline" (no scores) for this many days after it is
  // first switched on.
  @Column({ type: 'int', default: 28 })
  baselineDays: number;

  // Q1: a "Not ready for testing" whose cause is a dependency declared on
  // the task and owned by someone else is not counted against the
  // submitter. Applies only from the project's go-live date.
  @Column({ default: true })
  notReadyDeclaredDependencyExempt: boolean;

  // D3: a risk flag counts as early warning if raised at least this many
  // working days before the committed date.
  @Column({ type: 'int', default: 2 })
  earlyWarningWorkingDays: number;

  // D4: tasks whose committed date moved this many times or more are counted.
  @Column({ type: 'int', default: 2 })
  dateMovesFlagCount: number;

  // C5: an in-progress task is fresh if updated within this many working days.
  @Column({ type: 'int', default: 2 })
  statusFreshWorkingDays: number;

  // O3: chases are reported per this many tasks due.
  @Column({ type: 'int', default: 10 })
  chasesPerTasks: number;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;
}
