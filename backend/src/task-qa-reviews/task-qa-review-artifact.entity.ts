import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// One row per selected Artifact Type in a single "Ready for Feedback"
// submission - a review round can have several, all sharing the same
// taskQaReviewId (that round already stands in for the "batch", unlike
// Evidence which needed a separate batchId since one issue can hold many
// unrelated submissions at once).
@Entity('task_qa_review_artifacts')
export class TaskQaReviewArtifact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  taskQaReviewId: number;

  // varchar since 2026-11-06 (migrations/2026-11-artifact-types-config.sql)
  // so Admin can add types without a migration - see artifact-types/.
  @Column({ type: 'varchar', length: 60 })
  type: string;

  @Column({ type: 'text' })
  url: string;
}
