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

// 'qa' (default) is a round any QA teammate can pick up from the tenant-
// wide QA queue - reviewerUserId/Email stay null. 'peer' is a Peer Review
// round (see PeerReviewsService, backend/src/peer-reviews/) - the
// Assignee picks one specific Developer as reviewerUserId/Email at submit
// time, and only that person may approve/reject it. Both types share this
// same table/roundNumber sequence and status values on purpose, so the
// retest counter and the KPI QA-rejection penalty
// (KpiService.computeMetrics) count a peer rejection exactly like a QA
// one with no extra code.
export type TaskQaReviewType = 'qa' | 'peer';

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

  @Column({ default: 'qa' })
  reviewType: TaskQaReviewType;

  // Set only for reviewType 'peer' - the Developer the Assignee chose as
  // reviewer at submit time. Null for 'qa' rounds.
  @Column({ nullable: true })
  reviewerUserId: number;

  @Column({ nullable: true })
  reviewerEmail: string;

  @Column({ nullable: true })
  reviewedByUserId: number;

  @Column({ nullable: true })
  reviewedByEmail: string;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date;

  @Column({ type: 'text', nullable: true })
  qaComment: string;
}
