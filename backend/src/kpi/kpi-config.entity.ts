import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Singleton row per tenant (mirrors performance_scoring_config's pattern
// exactly - "distinct named settings" fit a single row with named
// columns better than a repeating key/value table). Defaults are the
// spec's own "Suggested Weights". Only ever affects KPI period rows
// generated AFTER a change - already-frozen KpiPeriodScore rows embed
// their own snapshot of these values and are never recomputed.
@Entity('kpi_config')
export class KpiConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  // W1 - Hours Exceed % weight
  @Column({ type: 'numeric', precision: 4, scale: 2, default: 0.15 })
  hoursExceedWeight: number;

  // W2 - Overdue Tickets % weight
  @Column({ type: 'numeric', precision: 4, scale: 2, default: 0.25 })
  overdueWeight: number;

  // W3 - Target Miss % weight
  @Column({ type: 'numeric', precision: 4, scale: 2, default: 0.15 })
  targetMissWeight: number;

  // W4 - Excessive QA Rejection Flag weight
  @Column({ type: 'numeric', precision: 4, scale: 2, default: 0.2 })
  qaRejectionWeight: number;

  // W5 - Outbound Dependency Overdue % weight
  @Column({ type: 'numeric', precision: 4, scale: 2, default: 0.15 })
  outboundDependencyWeight: number;

  // W6 - Completion % bonus weight
  @Column({ type: 'numeric', precision: 4, scale: 2, default: 0.15 })
  completionBonusWeight: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 10 })
  completionBonusCap: number;

  // Not given a specific value in the spec formula itself - the
  // "Excessive QA Rejection Flag" needs a cutoff to trip on and none was
  // specified, so this is admin-configurable like the weights.
  @Column({ type: 'int', default: 2 })
  excessiveRejectionThreshold: number;

  @Column({ nullable: true })
  updatedByUserId: number;

  @Column({ nullable: true })
  updatedByEmail: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
