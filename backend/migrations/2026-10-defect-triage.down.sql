-- Rollback of 2026-10-defect-triage.sql. Deploy the previous code first.
-- Refuses while any defect is still Disputed, so nothing is stranded in a
-- status the old code doesn't know. Drops the classification and triage
-- history - take a backup first if it should be kept.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project_tasks" WHERE "status" = 'Disputed') THEN
    RAISE EXCEPTION 'Defects are still Disputed - have the PM decide them first.';
  END IF;
END $$;
DELETE FROM "task_status_percent_config" WHERE "status" = 'Disputed';
DROP TABLE IF EXISTS "defect_triages";
ALTER TABLE "team_settings" DROP COLUMN IF EXISTS "defectTriageSettings";
ALTER TABLE "project_tasks"
  DROP COLUMN IF EXISTS "severity",
  DROP COLUMN IF EXISTS "defectType",
  DROP COLUMN IF EXISTS "defectOrigin",
  DROP COLUMN IF EXISTS "foundInBuild",
  DROP COLUMN IF EXISTS "foundInEnvironment",
  DROP COLUMN IF EXISTS "triageStatus";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "defectTriageEnabled";
COMMIT;
