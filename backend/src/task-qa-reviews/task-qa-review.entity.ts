import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Artifact types accepted for a Task's "Ready for Feedback" submission.
// A separate enum from evidence.entity.ts's EvidenceType - this is scoped
// to the Task QA-review flow (Stage 4/5/6), not the Issue-oriented
// Evidence feature, and doesn't need that enum's link-only categories
// (SharePoint/OneDrive/Git Commit) that don't apply to a build artifact.
export enum TaskArtifactType {
  APK_BUILD = 'APK Build',
  BUILD_PIPELINE_LINK = 'Build Pipeline Link',
  DEPLOYMENT_REPORT = 'Deployment Report',
  PULL_REQUEST_LINK = 'Pull Request Link',
  SCREENSHOT = 'Screenshot',
  DEMO_VIDEO = 'Demo Video',
  TECHNICAL_DOCUMENTATION = 'Technical Documentation',
}

export type TaskQaReviewStatus = 'pending' | 'approved' | 'rejected';

// One row per QA review round on a Task (Stage 4/5/6). The Assignee's
// "Ready for Feedback" submission creates a new pending row; QA's
// approve/reject fills in the review outcome fields on that same row.
// Rows are never overwritten across rounds - a rejection followed by a
// resubmission is a brand new row with the next roundNumber, so every
// past round's resolution/artifact/QA comment stays visible and
// countable (feeds the future "QA Failed more than 3 times" escalation
// concept) instead of the latest round clobbering the previous one.
@Entity('task_qa_reviews')
export class TaskQaReview {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column({ type: 'int' })
  roundNumber: number;

  @Column({ type: 'text' })
  resolution: string;

  @Column({ type: 'enum', enum: TaskArtifactType })
  artifactType: TaskArtifactType;

  @Column({ type: 'text' })
  artifactUrl: string;

  @Column()
  submittedByUserId: number;

  @Column()
  submittedByEmail: string;

  @CreateDateColumn()
  submittedAt: Date;

  // 'pending' until QA acts, then 'approved' or 'rejected'. Plain string
  // column (not a DB enum) - same convention as ProjectTask.status.
  @Column({ default: 'pending' })
  status: TaskQaReviewStatus;

  @Column({ nullable: true })
  reviewedByUserId: number;

  @Column({ nullable: true })
  reviewedByEmail: string;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date;

  @Column({ type: 'text', nullable: true })
  qaComment: string;
}
