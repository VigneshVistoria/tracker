-- Rollback for 2026-10-performance-metrics.sql. Drops only the three new
-- tables; tickets and audit_logs are untouched (the events can be rebuilt
-- from audit_logs with the backfill script). Deploy the previous code
-- first - the current code writes to task_commitment_events.
BEGIN;
DROP TABLE "performance_holidays";
DROP TABLE "performance_metric_settings";
DROP TABLE "task_commitment_events";
COMMIT;
