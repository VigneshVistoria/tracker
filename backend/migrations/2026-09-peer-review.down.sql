-- Down-migration for 2026-09-peer-review.sql. Clean additive change, fully
-- reversible - deletes only the seeded config rows and dropped columns,
-- never touches any pre-existing task_qa_reviews/project_tasks data.

DELETE FROM "task_status_percent_config" WHERE "status" IN ('Peer Review', 'Re-Peer-Review');

DROP INDEX IF EXISTS "IDX_task_qa_reviews_tenant_reviewer_status";

ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "reviewerEmail";
ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "reviewerUserId";
ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "reviewType";

ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "peerReviewEnabled";
