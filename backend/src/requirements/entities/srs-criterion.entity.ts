import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { CriterionResult } from '../requirements';

// One numbered acceptance criterion and its CURRENT result. Every result
// ever recorded is also in srs_criterion_results (append-only).
@Entity('srs_criteria')
export class SrsCriterion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  storyId: number;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', length: 10, default: 'not_run' })
  result: CriterionResult;

  @Column({ type: 'text', nullable: true })
  resultNote: string | null;

  @Column({ type: 'int', nullable: true })
  resultByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  resultAt: Date | null;

  // Recorded while the story was still Draft ("recorded before approval").
  @Column({ default: false })
  resultBeforeApproval: boolean;

  // Stage 4 change impact.
  @Column({ default: false })
  needsReview: boolean;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  deletedByUserId: number | null;
}
