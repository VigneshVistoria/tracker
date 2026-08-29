import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Which SLA target applies to a given issue - resolved in priority order
// by SlaService.resolveTargetKey(): SHOWSTOPPER first (issue.showstopper
// === true overrides everything else, regardless of priority), then the
// issue's Priority value, then DEFAULT for issues with no priority set at
// all. One row per key, seeded with starting defaults by the migration -
// every value below is admin-editable from there on, nothing is
// hardcoded into application logic.
export enum SlaTargetKey {
  SHOWSTOPPER = 'Showstopper',
  CRITICAL = 'Critical',
  HIGH = 'High',
  MEDIUM = 'Medium',
  LOW = 'Low',
  DEFAULT = 'Default',
}

@Entity('sla_configs')
export class SlaConfig {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  @Column({ type: 'enum', enum: SlaTargetKey, unique: true })
  key: SlaTargetKey;

  // Plain hours rather than a "days/hours" split - simplest unit that
  // still supports sub-day targets (a Showstopper's 4-hour target
  // wouldn't round cleanly to whole days).
  @Column({ type: 'int' })
  targetHours: number;

  @Column({ nullable: true })
  updatedByUserId: number;

  @Column({ nullable: true })
  updatedByEmail: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
