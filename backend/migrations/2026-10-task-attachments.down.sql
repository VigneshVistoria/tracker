-- Rollback for 2026-10-task-attachments.sql. Roll the app back first (the
-- attachment endpoints need the table), then drop it. The stored files
-- stay in the "task-attachments" bucket until removed there.
BEGIN;
DROP TABLE "task_attachments";
COMMIT;
