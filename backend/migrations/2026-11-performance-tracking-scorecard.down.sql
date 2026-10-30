-- Rollback for 2026-11-performance-tracking-scorecard.sql. Drops the
-- overrides table (override history is lost - it stays in audit_logs) and
-- the overrideRoles setting. Deploy the previous code first.
BEGIN;
DROP TABLE IF EXISTS "performance_score_overrides";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "overrideRoles";
COMMIT;
