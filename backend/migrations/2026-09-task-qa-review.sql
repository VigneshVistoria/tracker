-- Task Lifecycle Stage 4/5/6: QA review. Reuses the existing
-- 'Ready for Feedback' / 'Feedback Pass' / 'Feedback Failed' TASK_STATUSES
-- values (previously defined but unwired to any real workflow) rather
-- than introducing new status strings. One task_qa_reviews row per
-- submission round, so a rejection's comment is never lost when the
-- Assignee resubmits - each round is its own row, countable for a future
-- "QA Failed more than N times" escalation rule.

CREATE TYPE "public"."task_qa_reviews_artifacttype_enum" AS ENUM(
  'APK Build',
  'Build Pipeline Link',
  'Deployment Report',
  'Pull Request Link',
  'Screenshot',
  'Demo Video',
  'Technical Documentation'
);

CREATE TABLE "task_qa_reviews" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "roundNumber" integer NOT NULL,
  "resolution" text NOT NULL,
  "artifactType" "public"."task_qa_reviews_artifacttype_enum" NOT NULL,
  "artifactUrl" text NOT NULL,
  "submittedByUserId" integer NOT NULL,
  "submittedByEmail" character varying NOT NULL,
  "submittedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "status" character varying NOT NULL DEFAULT 'pending',
  "reviewedByUserId" integer,
  "reviewedByEmail" character varying,
  "reviewedAt" TIMESTAMP,
  "qaComment" text
);

ALTER TABLE "task_qa_reviews"
  ADD CONSTRAINT "FK_task_qa_reviews_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");
ALTER TABLE "task_qa_reviews"
  ADD CONSTRAINT "FK_task_qa_reviews_task" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id");

CREATE INDEX "IDX_task_qa_reviews_tenant_task" ON "task_qa_reviews" ("tenantId", "taskId");
CREATE INDEX "IDX_task_qa_reviews_tenant_status" ON "task_qa_reviews" ("tenantId", "status");
