-- Rollback for 2026-10-performance-tracking-proposed-dates.sql. Turns
-- own-date commitments back into due_changed, deletes Confirm events and
-- restores the old kind list. Deploy the previous code first.
BEGIN;
DELETE FROM "task_commitment_events" WHERE "kind" = 'due_committed' AND "oldDueDate" IS NOT DISTINCT FROM "newDueDate";
UPDATE "task_commitment_events"
   SET "kind" = CASE WHEN "oldDueDate" IS NULL THEN 'due_set' ELSE 'due_changed' END,
       "direction" = CASE WHEN "oldDueDate" IS NULL THEN NULL WHEN "newDueDate" > "oldDueDate" THEN 'later' ELSE 'earlier' END
 WHERE "kind" = 'due_committed';
ALTER TABLE "task_commitment_events" DROP CONSTRAINT "CHK_task_commitment_events_kind";
ALTER TABLE "task_commitment_events" ADD CONSTRAINT "CHK_task_commitment_events_kind"
  CHECK ("kind" IN ('assigned', 'unassigned', 'due_set', 'due_changed', 'due_cleared'));
COMMIT;
