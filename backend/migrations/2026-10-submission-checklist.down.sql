-- Rollback of 2026-10-submission-checklist.sql. Deploy the previous code
-- first. Drops the checklists stored on review rounds - take a backup first
-- if they should be kept. Rounds that used "Submission incomplete" keep it
-- as text; it is only taken off the saved list.
BEGIN;
UPDATE "team_settings" SET "qaNotReadyReasons" = "qaNotReadyReasons" - 'Submission incomplete'
 WHERE "qaNotReadyReasons" ? 'Submission incomplete' AND jsonb_array_length("qaNotReadyReasons") > 1;
ALTER TABLE "team_settings" DROP COLUMN IF EXISTS "submissionChecklistSettings";
ALTER TABLE "task_qa_reviews" DROP COLUMN IF EXISTS "submissionChecklist";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "submissionChecklistEnabled";
COMMIT;
