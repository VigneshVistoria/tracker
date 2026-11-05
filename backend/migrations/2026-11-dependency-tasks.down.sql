-- Rollback of 2026-11-dependency-tasks.sql. Stops if anything uses the new
-- columns: dependency tasks would otherwise silently become ordinary tasks
-- that count in every score, and cancelled tickets would break the old
-- status rule. Deploy the previous code first.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project_tasks" WHERE "dependencyTicketId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback stopped: dependency tasks exist (project_tasks.dependencyTicketId is set).';
  END IF;
  IF EXISTS (SELECT 1 FROM "task_dependency_tickets" WHERE "status" = 'cancelled') THEN
    RAISE EXCEPTION 'Rollback stopped: cancelled dependency tickets exist.';
  END IF;
END $$;

DROP TRIGGER "TRG_project_tasks_sync_dependency_ticket" ON "project_tasks";
DROP FUNCTION tracker_sync_dependency_ticket();
ALTER TABLE "task_dependency_tickets" DROP CONSTRAINT "CHK_task_dependency_tickets_status";
ALTER TABLE "task_dependency_tickets" DROP COLUMN "cancelReason", DROP COLUMN "cancelledByUserId", DROP COLUMN "cancelledAt";
DROP INDEX "UQ_project_tasks_dependency_ticket";
ALTER TABLE "project_tasks" DROP CONSTRAINT "FK_project_tasks_dependency_ticket";
ALTER TABLE "project_tasks" DROP COLUMN "dependencyTicketId";
ALTER TABLE "projects" DROP COLUMN "dependencyTasksEnabled";

COMMIT;
