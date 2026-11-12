-- Rollback of 2026-11-design-handover.sql. Drops design handover rows first
-- (they only make sense with the new columns).
BEGIN;
DELETE FROM "task_handovers" WHERE "kind" = 'design';
ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "designHandoverId";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "designHandoverEnabled";
DROP INDEX IF EXISTS "IDX_task_handovers_linked_task";
ALTER TABLE "task_handovers" DROP CONSTRAINT IF EXISTS "CHK_task_handovers_kind";
ALTER TABLE "task_handovers" DROP COLUMN IF EXISTS "linkedTaskId";
ALTER TABLE "task_handovers" DROP COLUMN IF EXISTS "artifacts";
ALTER TABLE "task_handovers" DROP COLUMN IF EXISTS "kind";
COMMIT;
