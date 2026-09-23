-- Reverses 2026-09-task-hold-closed.sql. Only safe to run if no task is
-- currently sitting at 'Hold' or 'Closed' (their status would otherwise
-- point at a config row this deletes, and priorStatus data would be lost)
-- - check before running: SELECT id, status FROM project_tasks WHERE
-- status IN ('Hold', 'Closed');

DELETE FROM "task_status_percent_config" WHERE "status" IN ('Hold', 'Closed');
ALTER TABLE "project_tasks" DROP COLUMN "priorStatus";
