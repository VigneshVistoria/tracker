-- Rollback for 2026-11-performance-tracking-chase-notes.sql. Drops
-- task_chases, task_progress_notes and the new settings columns. Chase and
-- progress-note history and any saved decision settings are lost. Deploy
-- the previous code first - the current code reads these.
BEGIN;
DROP TABLE IF EXISTS "task_chases";
DROP TABLE IF EXISTS "task_progress_notes";
ALTER TABLE "performance_tracking_settings" DROP CONSTRAINT IF EXISTS "CHK_pts_blocker_lag_clock";
ALTER TABLE "performance_tracking_settings" DROP CONSTRAINT IF EXISTS "CHK_pts_non_compliance_display";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "blockerLagClockStart";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "percentBands";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "breachBands";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "nonComplianceDisplay";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "requestSources";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "chaseRoles";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "chaseCooldownHours";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "progressNoteMin";
COMMIT;
