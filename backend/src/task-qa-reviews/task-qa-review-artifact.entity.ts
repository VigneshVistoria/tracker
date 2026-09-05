import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { TaskArtifactType } from './task-qa-review.entity';

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

  @Column({ type: 'enum', enum: TaskArtifactType })
  type: TaskArtifactType;

  @Column({ type: 'text' })
  url: string;
}
