import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// QA's own evidence-of-testing artifacts, attached at Approve/Reject time
// - kept in a separate table from TaskQaReviewArtifact (the Assignee's
// submission-time artifacts) rather than a shared table with a source
// flag, so "what the Assignee submitted" and "what QA verified with" stay
// independently queryable, same as how Task-artifacts and Issue-evidence
// are already two independent tables for two independent flows.
export enum QaArtifactType {
  TEST_CASE_PLAN = 'Test Case / Test Plan',
  TEST_EXECUTION_REPORT = 'Test Execution Report',
  BUG_REPORT = 'Bug Report',
  SCREENSHOT = 'Screenshot',
  SCREEN_RECORDING = 'Screen Recording / Video',
  LOG_FILE = 'Log File',
  STAGING_ENVIRONMENT_URL = 'Staging / Test Environment URL',
  REGRESSION_TEST_RESULTS = 'Regression Test Results',
  AUTOMATED_TEST_RUN = 'Automated Test Run',
  SIGN_OFF_REPORT = 'Sign-off / Acceptance Report',
}

@Entity('task_qa_review_qa_artifacts')
export class TaskQaReviewQaArtifact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  taskQaReviewId: number;

  @Column({ type: 'enum', enum: QaArtifactType })
  type: QaArtifactType;

  @Column({ type: 'text' })
  url: string;
}
