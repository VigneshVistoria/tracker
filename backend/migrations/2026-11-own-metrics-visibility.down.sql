-- Rollback for 2026-11-own-metrics-visibility.sql. Drops the setting
-- (which roles may see their own figures). Deploy the previous code first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "ownMetricsRoles";
COMMIT;
