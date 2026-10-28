-- Rollback for 2026-10-performance-tracking-foundation.sql. Drops the two
-- triggers, their functions, the two new tables and the two project
-- columns. Tickets and audit_logs are untouched (the reconstructed part of
-- the status history can be rebuilt from audit_logs; live events written
-- since are lost). Deploy the previous code first - the current code reads
-- these columns.
BEGIN;
DROP TRIGGER IF EXISTS "TRG_audit_logs_link_status_event" ON "audit_logs";
DROP TRIGGER IF EXISTS "TRG_project_tasks_status_event" ON "project_tasks";
DROP FUNCTION IF EXISTS tracker_link_status_event();
DROP FUNCTION IF EXISTS tracker_task_status_event();
DROP FUNCTION IF EXISTS tracker_status_event_action(text);
DROP INDEX IF EXISTS "IDX_audit_logs_entity";
DROP TABLE IF EXISTS "task_status_events";
DROP TABLE IF EXISTS "performance_tracking_settings";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "performanceTrackingSince";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "performanceTrackingEnabled";
COMMIT;
