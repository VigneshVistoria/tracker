import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// Every Pass/Fail ever recorded. Append-only: a database trigger refuses
// UPDATE and DELETE (migrations/2026-11-requirements-s1.sql).
@Entity('srs_criterion_results')
export class SrsCriterionResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  criterionId: number;

  @Column()
  storyId: number;

  @Column({ type: 'varchar', length: 10 })
  result: 'pass' | 'fail';

  @Column({ type: 'text', nullable: true })
  note: string | null;

  // The story's status when this was recorded.
  @Column({ type: 'varchar', length: 20 })
  storyStatus: string;

  @Column()
  beforeApproval: boolean;

  @Column()
  recordedByUserId: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  recordedAt: Date;
}
