-- Developer submission checklist, defect triage Stage 2 (2026-10-27,
-- confirmed with the user). See backend/src/tasks/submission-checklist.ts.
-- Additive only: the switch is OFF for every project
-- (submissionChecklistEnabled = false), so nothing changes until a project
-- is switched on in Admin -> Submission Checklist Settings.
--   projects."submissionChecklistEnabled" - the per-project switch.
--   task_qa_reviews."submissionChecklist" - what the developer filled in on
--     that submission (with the labels as they were), null before Stage 2.
--   team_settings."submissionChecklistSettings" - the editable lists and
--     rules; '{}' means "never saved, use the defaults".
--   team_settings."qaNotReadyReasons" - "Submission incomplete" is added to
--     a saved list (an unsaved list, '[]', already gets it from the defaults).
-- Safe to run twice. Rollback: 2026-10-submission-checklist.down.sql.
BEGIN;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "submissionChecklistEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "task_qa_reviews" ADD COLUMN IF NOT EXISTS "submissionChecklist" jsonb NULL;
ALTER TABLE "team_settings" ADD COLUMN IF NOT EXISTS "submissionChecklistSettings" jsonb NOT NULL DEFAULT '{}';
UPDATE "team_settings"
   SET "qaNotReadyReasons" = "qaNotReadyReasons" || '["Submission incomplete"]'::jsonb
 WHERE jsonb_array_length("qaNotReadyReasons") > 0
   AND NOT ("qaNotReadyReasons" ? 'Submission incomplete');
COMMIT;
