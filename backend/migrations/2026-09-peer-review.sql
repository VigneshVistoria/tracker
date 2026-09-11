-- Peer Review: an opt-in alternative to QA review for specific tasks. The
-- PM (or Admin, via a dedicated endpoint) flags a task with
-- peerReviewEnabled; when the assignee submits it for review, it goes to
-- another Developer they pick instead of QA. Reuses the existing
-- task_qa_reviews table for peer rounds too (reviewType/reviewerUserId
-- columns) rather than a parallel table, so the retest counter
-- (roundNumber) and the KPI QA-rejection penalty
-- (KpiService.computeMetrics' qaReviewsRepository.find({status:'rejected'})
-- query, which has no reviewType filter) count a peer rejection exactly
-- like a QA one, automatically, with no KPI code changes.

ALTER TABLE "project_tasks" ADD COLUMN "peerReviewEnabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "task_qa_reviews" ADD COLUMN "reviewType" character varying NOT NULL DEFAULT 'qa';
ALTER TABLE "task_qa_reviews" ADD COLUMN "reviewerUserId" integer;
ALTER TABLE "task_qa_reviews" ADD COLUMN "reviewerEmail" character varying;

CREATE INDEX "IDX_task_qa_reviews_tenant_reviewer_status" ON "task_qa_reviews" ("tenantId", "reviewerUserId", "status");

-- Seed % Complete config rows for the two new statuses, same values as the
-- existing Feedback/Re-Feedback rows (task-status-percent.entity.ts).
INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Peer Review', 50
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Peer Review'
);

INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Re-Peer-Review', 50
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Re-Peer-Review'
);
