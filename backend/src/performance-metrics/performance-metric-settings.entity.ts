import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Performance metrics rules and thresholds (2026-10-27) - one row per
// tenant, edited by Admin and Program Manager from Admin -> Performance
// Metrics Settings. Nothing here is fixed in code: a tenant with no row
// uses PERFORMANCE_SETTINGS_DEFAULTS (./performance-metrics.compute.ts),
// the values agreed with the user, and nothing is written until someone
// saves. Every save is audited.
@Entity('performance_metric_settings')
export class PerformanceMetricSettings {
  @PrimaryColumn()
  tenantId: number;

  // IANA zone the working days are counted in.
  @Column({ default: 'Africa/Addis_Ababa' })
  timeZone: string;

  // The Due date must be set by the end of this many working days after
  // the day of assignment (1 = the next working day).
  @Column({ type: 'int', default: 1 })
  dueDateWorkingDays: number;

  // Days of the week that are never working days, as JS day numbers
  // (0 = Sunday ... 6 = Saturday), comma separated.
  @Column({ type: 'varchar', length: 20, default: '0,6' })
  weekendDays: string;

  // Rolling window for the status, in days, ending on the report's To date.
  @Column({ type: 'int', default: 28 })
  windowDays: number;

  // Fewer tasks / submissions than this in the window = "not enough data".
  @Column({ type: 'int', default: 5 })
  minSample: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 90 })
  onTimeOkPercent: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0.5 })
  changesOkPerTask: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 75 })
  qaAcceptanceOkPercent: string;

  // Tasks in these statuses (by current status) are left out of every
  // measure, comma separated.
  @Column({ type: 'varchar', default: 'Junk,Hold' })
  excludedStatuses: string;

  // Count Peer Review rounds in QA acceptance as well as QA rounds.
  @Column({ default: false })
  includePeerReview: boolean;

  // Count a round QA escalated to the PM as decided (neither accepted
  // nor rejected).
  @Column({ default: false })
  countEscalatedAsDecided: boolean;

  // A task that already has a Due date when it is assigned (reassigned, or
  // dated while unassigned) counts as on time for the new assignee.
  @Column({ default: true })
  alreadyDatedCountsOnTime: boolean;

  // A Due date set by someone other than the assignee (a PM) counts as on
  // time for the assignee, if set in time.
  @Column({ default: true })
  othersSettingDateCountsOnTime: boolean;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;
}
