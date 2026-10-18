-- Screenshots on a QA decision (2026-10-18, confirmed with the user): the
-- QA who approves, rejects or escalates a task/defect (incl. a retest)
-- can attach screenshots to that review round - same pipeline, bucket and
-- limits as defect screenshots (task_attachments). New table only.
BEGIN;
CREATE TABLE "task_qa_review_attachments" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "taskQaReviewId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "uploadedByUserId" integer NOT NULL,
  "fileName" character varying(200) NOT NULL,
  "mimeType" character varying(100) NOT NULL,
  "sizeBytes" integer NOT NULL,
  "storageKey" character varying(300) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "task_qa_review_attachments"
  ADD CONSTRAINT "FK_task_qa_review_attachments_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");
ALTER TABLE "task_qa_review_attachments"
  ADD CONSTRAINT "FK_task_qa_review_attachments_review" FOREIGN KEY ("taskQaReviewId") REFERENCES "task_qa_reviews"("id") ON DELETE CASCADE;
ALTER TABLE "task_qa_review_attachments"
  ADD CONSTRAINT "FK_task_qa_review_attachments_task" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE CASCADE;

CREATE INDEX "IDX_task_qa_review_attachments_round" ON "task_qa_review_attachments" ("taskQaReviewId");
CREATE INDEX "IDX_task_qa_review_attachments_task" ON "task_qa_review_attachments" ("taskId");
COMMIT;
