-- QA-side artifacts: at Approve/Reject time, QA can (optionally) attach
-- one or more evidence-of-testing artifacts, same Artifact Type/URL shape
-- as the Assignee's submission-time artifacts (task_qa_review_artifacts)
-- but kept in their own table since they're a separate actor's evidence
-- attached at a separate stage of the same review round.

CREATE TYPE "task_qa_review_qa_artifacts_type_enum" AS ENUM (
  'Test Case / Test Plan',
  'Test Execution Report',
  'Bug Report',
  'Screenshot',
  'Screen Recording / Video',
  'Log File',
  'Staging / Test Environment URL',
  'Regression Test Results',
  'Automated Test Run',
  'Sign-off / Acceptance Report'
);

CREATE TABLE "task_qa_review_qa_artifacts" (
  "id" SERIAL PRIMARY KEY,
  "taskQaReviewId" integer NOT NULL,
  "type" task_qa_review_qa_artifacts_type_enum NOT NULL,
  "url" text NOT NULL
);

CREATE INDEX "IDX_task_qa_review_qa_artifacts_review" ON "task_qa_review_qa_artifacts" ("taskQaReviewId");
