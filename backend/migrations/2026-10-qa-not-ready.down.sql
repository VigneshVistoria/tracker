-- Rollback of 2026-10-qa-not-ready.sql. Deploy the previous code first.
-- Refuses while any ticket or round still uses the feature, so nothing is
-- stranded in a status the old code doesn't know.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project_tasks" WHERE "status" = 'Not Ready for Testing')
     OR EXISTS (SELECT 1 FROM "task_qa_reviews" WHERE "status" = 'not_ready') THEN
    RAISE EXCEPTION 'Tickets or review rounds still use "Not ready for testing" - move them first.';
  END IF;
END $$;
DELETE FROM "task_status_percent_config" WHERE "status" = 'Not Ready for Testing';
ALTER TABLE "team_settings" DROP COLUMN IF EXISTS "qaNotReadyReasons";
ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "notReadyReason";
COMMIT;
