-- Create Defect: optional evidence QA attaches when filing the defect
-- (e.g. a screenshot or bug report proving it) - reuses the exact same
-- QaArtifactType enum/values as task_qa_review_qa_artifacts (QA's own
-- evidence at Approve/Reject time), since this is the same "QA's own
-- evidence" concept just captured at ticket-creation instead. Separate
-- table, keyed to taskId directly, since a brand-new defect has no QA
-- review round yet to attach to.

CREATE TYPE "task_defect_artifacts_type_enum" AS ENUM (
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

CREATE TABLE "task_defect_artifacts" (
  "id" SERIAL PRIMARY KEY,
  "taskId" integer NOT NULL,
  "type" task_defect_artifacts_type_enum NOT NULL,
  "url" text NOT NULL
);

ALTER TABLE "task_defect_artifacts"
  ADD CONSTRAINT "FK_task_defect_artifacts_task" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id");

CREATE INDEX "IDX_task_defect_artifacts_task" ON "task_defect_artifacts" ("taskId");
