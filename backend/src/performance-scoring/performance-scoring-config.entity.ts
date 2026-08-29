import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum OverduePenaltyMode {
  TIERED = 'Tiered',
  FLAT = 'Flat',
}

// Singleton row (there's only ever one - the migration seeds exactly one
// and PerformanceScoringService always reads/updates that same row) for
// the Performance Dashboard's scoring weights. Unlike SlaConfig (one row
// per repeating key), these are distinct named settings, so a single row
// with named columns fits better than a key/value table.
@Entity('performance_scoring_config')
export class PerformanceScoringConfig {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  // Whether the overdue penalty comes from OverduePenaltyTier rows
  // (default) or a single flat percentage below - lets an admin switch
  // to a flat per-item penalty without losing the tier data.
  @Column({ type: 'enum', enum: OverduePenaltyMode, default: OverduePenaltyMode.TIERED })
  overduePenaltyMode: OverduePenaltyMode;

  // Only used when overduePenaltyMode is Flat.
  @Column({ type: 'int', default: 10 })
  flatOverduePenaltyPercent: number;

  @Column({ type: 'int', default: 15 })
  qaFailedWeightPercent: number;

  @Column({ type: 'int', default: 10 })
  reopenedWeightPercent: number;

  @Column({ type: 'int', default: 10 })
  lateDependencyWeightPercent: number;

  @Column({ type: 'int', default: 5 })
  earlyCompletionBonusPercent: number;

  @Column({ nullable: true })
  updatedByUserId: number;

  @Column({ nullable: true })
  updatedByEmail: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
