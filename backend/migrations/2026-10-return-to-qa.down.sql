-- Undo 2026-10-return-to-qa.sql. Only safe once no ticket is in
-- 'Returned to QA' (send them back to Development first).
BEGIN;
DELETE FROM "task_status_percent_config" WHERE "status" = 'Returned to QA';
COMMIT;
