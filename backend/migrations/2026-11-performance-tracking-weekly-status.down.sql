-- Rollback for 2026-11-performance-tracking-weekly-status.sql. Drops the
-- weekly status reports (lost) and the 3 C3 settings. Deploy the previous
-- code first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP CONSTRAINT IF EXISTS "CHK_pts_weeklyReportDeadlineDay";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "weeklyReportMinLength";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "weeklyReportDeadlineTime";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "weeklyReportDeadlineDay";
DROP TABLE IF EXISTS "weekly_status_reports";
COMMIT;
