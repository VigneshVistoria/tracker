-- Rollback for 2026-11-performance-tracking-handovers.sql. Drops the
-- handovers (lost) and the C4 setting. Deploy the previous code first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "handoverFieldMin";
DROP TABLE IF EXISTS "task_handovers";
COMMIT;
