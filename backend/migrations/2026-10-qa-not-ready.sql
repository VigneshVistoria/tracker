-- QA Reject as "Not ready for testing" (2026-10-27, confirmed with the
-- user). See backend/src/tasks/qa-not-ready.ts.
--   task_qa_reviews."notReadyReason" - the reason QA picked, on a
--     'not_ready' round (status is plain varchar, no CHECK to change).
--   team_settings."qaNotReadyReasons" - the editable reasons list; '[]'
--     means "never saved, use the six defaults".
--   task_status_percent_config - the % Complete row for the new status
--     'Not Ready for Testing', for every tenant (0%, like PM Feedback).
-- Safe to run twice. Rollback: 2026-10-qa-not-ready.down.sql.
BEGIN;
ALTER TABLE "task_qa_reviews" ADD COLUMN IF NOT EXISTS "notReadyReason" varchar(100) NULL;
ALTER TABLE "team_settings" ADD COLUMN IF NOT EXISTS "qaNotReadyReasons" jsonb NOT NULL DEFAULT '[]';
INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Not Ready for Testing', 0
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Not Ready for Testing'
);
COMMIT;
