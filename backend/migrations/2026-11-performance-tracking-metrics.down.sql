-- Rollback for 2026-11-performance-tracking-metrics.sql. Drops both
-- tables; every stored snapshot is lost (they can be recalculated from the
-- raw data). Deploy the previous code first - the current code reads them.
BEGIN;
DROP TABLE IF EXISTS "performance_metric_snapshots";
DROP TABLE IF EXISTS "performance_metric_runs";
COMMIT;
