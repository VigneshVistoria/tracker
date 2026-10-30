-- Rollback for 2026-11-performance-tracking-escalation-reasons.sql. Drops
-- the escalation reasons (lost) and the setting. Deploy the previous code
-- first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "escalationsPerRounds";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "escalationReasons";
ALTER TABLE "task_qa_reviews" DROP CONSTRAINT IF EXISTS "CHK_task_qa_reviews_escalation_reason";
ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "escalationAvoidable";
ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "escalationReasonCode";
COMMIT;
