import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { QaArtifactType } from '../task-qa-reviews/task-qa-review-qa-artifact.entity';

// Optional evidence QA attaches when filing a defect (e.g. a screenshot
// or bug report) - reuses QaArtifactType since this is the same "QA's own
// evidence" concept as TaskQaReviewQaArtifact (attached at Approve/Reject
// time), just captured at ticket-creation instead. Its own table, keyed
// to taskId directly rather than a taskQaReviewId, since a brand-new
// defect has no review round yet to attach to.
@Entity('task_defect_artifacts')
export class TaskDefectArtifact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  taskId: number;

  @Column({ type: 'enum', enum: QaArtifactType })
  type: QaArtifactType;

  @Column({ type: 'text' })
  url: string;
}
