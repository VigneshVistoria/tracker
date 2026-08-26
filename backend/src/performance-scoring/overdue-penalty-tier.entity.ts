import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// One row per "N to M days late" bracket, only consulted when
// PerformanceScoringConfig.overduePenaltyMode is Tiered. maxDaysLate
// null means "and beyond" - the top, unbounded tier. Admin-editable:
// tiers can be added, edited, or removed entirely from the Performance
// Scoring Configuration page.
@Entity('overdue_penalty_tiers')
export class OverduePenaltyTier {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  minDaysLate: number;

  @Column({ type: 'int', nullable: true })
  maxDaysLate: number;

  @Column({ type: 'int' })
  penaltyPercent: number;

  // Display/evaluation order - lowest first, ascending by minDaysLate in
  // practice, but kept explicit rather than re-sorting by minDaysLate
  // every time so an admin's own ordering survives if tiers ever overlap.
  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}
