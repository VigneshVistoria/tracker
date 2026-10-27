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

// 'escalated' - QA Feedback escalated to PM instead of Approve/Reject
// (TaskQaReviewsService.escalate(), 'qa'-type rounds only - never reached
// from the Peer Review path). Ends the round the same way
// 'approved'/'rejected' do (reviewedByUserId/reviewedAt stamped), reusing
// the same qaComment field reject() uses for its reason - just a
// different terminal outcome, not a rejection, so it never touches
// KpiService's rejection-count query (status: 'rejected' only).
// 'reverted' (2026-10-13) - a QA approve/reject a Program Manager or
// Admin undid as a mistake (TaskQaReviewsService.revertDecision()). The
// row keeps the QA's decision fields as history, revertedBy/At/Reason say
// who undid it, and a fresh 'pending' round re-opens the same submission.
// Every count keys off 'approved'/'rejected', so a reverted round no
// longer counts anywhere (KPI, Summary tiles, rejection rate).
// 'withdrawn' (2026-10-16) - a Program Manager or Admin pulled a still-
// pending QA round back before QA decided it and sent the task to the
// developer (TaskQaReviewsService.sendBackFromQa()). reviewedBy/At and
// qaComment hold who did it and why, as on a 'pm' round. Not a QA
// decision: it counts nowhere, and it doesn't make the next submit a
// resubmission (the task goes back to Feedback, not Re-Feedback).
// 'not_ready' (2026-10-27) - QA could not start testing ("Not ready for
// testing", TaskQaReviewsService.markNotReady()); notReadyReason holds the
// reason picked from the list and qaComment QA's comment. Not a QA
// decision either: never a rejection, and the resubmission is a first-time
// Feedback. Counted only as an "incomplete submission" (see
// backend/src/tasks/qa-not-ready.ts).
export type TaskQaReviewStatus = 'pending' | 'approved' | 'rejected' | 'escalated' | 'reverted' | 'withdrawn' | 'not_ready';

// Rounds that never stood as a review verdict - left out of the first-
// time vs resubmission count (Feedback vs Re-Feedback) and of every
// "earlier decision" check.
export const NON_VERDICT_ROUND_STATUSES: TaskQaReviewStatus[] = ['reverted', 'withdrawn', 'not_ready'];

// 'qa' (default) is a round any QA teammate can pick up from the tenant-
// wide QA queue - reviewerUserId/Email stay null. 'peer' is a Peer Review
// round (see PeerReviewsService, backend/src/peer-reviews/) - the
// Assignee picks one specific Developer as reviewerUserId/Email at submit
// time, and only that person may approve/reject it. Both types share this
// same table/roundNumber sequence and status values on purpose, so the
// retest counter and the KPI QA-rejection penalty
// (KpiService.computeMetrics) count a peer rejection exactly like a QA
// one with no extra code.
// 'pm' (2026-10-13) - the PM review gate before QA (backend/src/tasks/
// pm-review.ts): approved = sent to QA (a fresh 'qa' round is opened),
// rejected = sent back to the developer as PM Feedback. Never a QA
// decision - every QA count, the retest counter and the KPI rejection
// count leave 'pm' rounds out.
export type TaskQaReviewType = 'qa' | 'peer' | 'pm';

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

  // Set only on a 'not_ready' round - the reason QA picked, copied as text
  // so editing the reasons list later never changes history
  // (migrations/2026-10-qa-not-ready.sql).
  @Column({ type: 'varchar', length: 100, nullable: true })
  notReadyReason: string | null;

  // The developer's submission checklist on this round (defect triage
  // Stage 2, 2026-10-27, see tasks/submission-checklist.ts) - null when the
  // project had it off or before it existed.
  @Column({ type: 'jsonb', nullable: true })
  submissionChecklist: Record<string, unknown> | null;

  // Set only on a 'reverted' round - see TaskQaReviewStatus above
  // (migrations/2026-10-qa-decision-revert.sql).
  @Column({ type: 'int', nullable: true })
  revertedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  revertedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  revertReason: string | null;

  // The decision that was undone ('approved' | 'rejected' | 'not_ready') -
  // status itself now says 'reverted', so the history needs this to say
  // what QA did.
  @Column({ type: 'varchar', nullable: true })
  revertedDecision: 'approved' | 'rejected' | 'not_ready' | null;

  // 'pm' rounds only - when the waiting-too-long reminder went to the PMs
  // / to the Admins, so each goes out once.
  @Column({ type: 'timestamp', nullable: true })
  reminderSentAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  adminReminderSentAt: Date | null;

  // Set asynchronously, after the row is created, by NoteQualityService's
  // free-tier Gemini call (fire-and-forget from
  // TaskQaReviewsService.submit()/PeerReviewsService.submit() - never
  // awaited, so a slow/failed/rate-limited check can't add latency to or
  // block a submission). NULL means "not checked yet" (feature disabled,
  // rate-limited, or the call failed) - deliberately distinct from `false`
  // ("checked, not vague") so NonComplianceReportService can tell "clean"
  // apart from "unchecked".
  @Column({ nullable: true })
  noteQualityFlagged: boolean;

  @Column({ type: 'text', nullable: true })
  noteQualityReason: string;
}
