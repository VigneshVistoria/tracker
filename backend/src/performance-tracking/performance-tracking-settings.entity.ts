import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { UserRole } from '../users/user.entity';
import { BlockerLagClockStart, NonComplianceDisplay, RequestSource } from './performance-tracking';

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

  // Q3 (S4): a reopen counts within this many days of the Pass.
  @Column({ type: 'int', default: 30 })
  reopenWindowDays: number;

  // B1 (2026-10-30): the open decisions as settings - see
  // ./performance-tracking.ts. migrations/2026-11-performance-tracking-
  // chase-notes.sql.
  @Column({ type: 'varchar', length: 40, default: 'dependency_overdue_or_blocker' })
  blockerLagClockStart: BlockerLagClockStart;

  @Column({ type: 'jsonb', default: () => "'[95, 85, 70, 50]'" })
  percentBands: number[];

  @Column({ type: 'jsonb', default: () => "'[0, 1, 2, 3]'" })
  breachBands: number[];

  @Column({ type: 'varchar', length: 20, default: 'side_by_side' })
  nonComplianceDisplay: NonComplianceDisplay;

  @Column({ type: 'jsonb', default: () => `'["owned_dependency", "marked_request"]'` })
  requestSources: RequestSource[];

  @Column({ type: 'jsonb', default: () => `'["admin", "program_manager", "executive", "qa", "developer"]'` })
  chaseRoles: UserRole[];

  @Column({ type: 'int', default: 24 })
  chaseCooldownHours: number;

  @Column({ type: 'int', default: 20 })
  progressNoteMin: number;

  // B3 (migrations/2026-11-performance-tracking-scorecard.sql). NOT USED
  // since B4 (overrideUserIds replaced it); kept until B8 drops the column.
  @Column({ type: 'jsonb', default: () => `'["admin"]'` })
  overrideRoles: UserRole[];

  // B4 (migrations/2026-11-performance-tracking-calendar-requests.sql).
  @Column({ type: 'jsonb', default: () => "'[]'" })
  overrideUserIds: number[];

  @Column({ type: 'varchar', length: 60, default: 'Africa/Addis_Ababa' })
  calendarTimeZone: string;

  @Column({ type: 'varchar', length: 5, default: '07:30' })
  calendarWorkStart: string;

  @Column({ type: 'varchar', length: 5, default: '15:30' })
  calendarWorkEnd: string;

  @Column({ type: 'jsonb', default: () => "'[0, 6]'" })
  calendarWeekendDays: number[];

  @Column({ type: 'int', default: 4 })
  responseTargetWorkingHours: number;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;
}
