-- Non-Compliance Report flag thresholds as editable settings (2026-10-27,
-- approved by the user): the four fixed thresholds that decide "Flagged"
-- move onto performance_metric_settings, with today's values as the
-- defaults, so nothing changes until someone edits them. Additive only.
-- Rollback: 2026-10-non-compliance-flag-settings.down.sql.
BEGIN;
ALTER TABLE "performance_metric_settings"
  ADD COLUMN "lateToQaFlagCount" integer NOT NULL DEFAULT 3,
  ADD COLUMN "rejectionRateFlagPercent" numeric(5,2) NOT NULL DEFAULT 20,
  ADD COLUMN "rejectionRateMinSubmissions" integer NOT NULL DEFAULT 3,
  ADD COLUMN "escalationFlagCount" integer NOT NULL DEFAULT 1,
  ADD COLUMN "vagueNotesFlagCount" integer NOT NULL DEFAULT 3;
COMMIT;
