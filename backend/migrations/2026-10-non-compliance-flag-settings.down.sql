-- Rollback for 2026-10-non-compliance-flag-settings.sql. Deploy the
-- previous code first - the current code reads these columns.
BEGIN;
ALTER TABLE "performance_metric_settings"
  DROP COLUMN "lateToQaFlagCount",
  DROP COLUMN "rejectionRateFlagPercent",
  DROP COLUMN "rejectionRateMinSubmissions",
  DROP COLUMN "escalationFlagCount",
  DROP COLUMN "vagueNotesFlagCount";
COMMIT;
