-- Dependency tasks, Stage 1 (Option B, decisions from the user 2026-11-05).
-- A dependency ticket with an internal owner gets a linked task, on
-- projects with the new switch ON (default OFF). The ticket stays the
-- record that blocks the parent task; the task carries the owner's
-- estimate, committed due date, status and progress notes.
--
--  * projects."dependencyTasksEnabled" - the per-project switch.
--  * project_tasks."dependencyTicketId" - the link, one task per ticket.
--  * task_dependency_tickets: cancel fields + status 'cancelled', and a
--    free-text external owner (ownerUserId/ownerEmail become optional).
--  * A trigger keeps the ticket in step with its task's status, whatever
--    path changed it: Pass / Closed / Released -> resolved (unblocks the
--    parent), Junk -> cancelled (unblocks), back to any working status ->
--    open again (blocks the parent again). Hold leaves the ticket as it is.
-- Rollback: 2026-11-dependency-tasks.down.sql.
BEGIN;

ALTER TABLE "projects" ADD COLUMN "dependencyTasksEnabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "project_tasks" ADD COLUMN "dependencyTicketId" integer NULL;
ALTER TABLE "project_tasks" ADD CONSTRAINT "FK_project_tasks_dependency_ticket"
  FOREIGN KEY ("dependencyTicketId") REFERENCES "task_dependency_tickets"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "UQ_project_tasks_dependency_ticket" ON "project_tasks" ("dependencyTicketId")
  WHERE "dependencyTicketId" IS NOT NULL;

ALTER TABLE "task_dependency_tickets"
  ADD COLUMN "cancelledAt" timestamp NULL,
  ADD COLUMN "cancelledByUserId" integer NULL,
  ADD COLUMN "cancelReason" text NULL;
ALTER TABLE "task_dependency_tickets" ADD CONSTRAINT "CHK_task_dependency_tickets_status"
  CHECK ("status" IN ('open', 'resolved', 'cancelled'));

-- External owners (Stage 4, added here so there is one migration): a
-- free-text owner instead of a user. Such a ticket has no user/email and
-- never gets a dependency task. Exactly one kind of owner per ticket;
-- every existing ticket has a user owner, so all pass the check.
ALTER TABLE "task_dependency_tickets"
  ADD COLUMN "ownerExternal" varchar(200) NULL,
  ALTER COLUMN "ownerUserId" DROP NOT NULL,
  ALTER COLUMN "ownerEmail" DROP NOT NULL;
ALTER TABLE "task_dependency_tickets" ADD CONSTRAINT "CHK_task_dependency_tickets_owner"
  CHECK (("ownerUserId" IS NOT NULL AND "ownerEmail" IS NOT NULL AND "ownerExternal" IS NULL)
      OR ("ownerUserId" IS NULL AND "ownerEmail" IS NULL AND btrim("ownerExternal") <> ''));

-- MUST match DEPENDENCY_TASK_RESOLVED_STATUSES / DEPENDENCY_TASK_CANCELLED_STATUS
-- in backend/src/task-dependency-tickets/dependency-tasks.ts - a test checks.
CREATE FUNCTION tracker_sync_dependency_ticket() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target varchar;
BEGIN
  IF NEW."status" IN ('Pass', 'Closed', 'Released - No Showstoppers', 'Released - With Showstoppers') THEN
    target := 'resolved';
  ELSIF NEW."status" = 'Junk' THEN
    target := 'cancelled';
  ELSIF NEW."status" = 'Hold' THEN
    RETURN NULL;
  ELSE
    target := 'open';
  END IF;

  UPDATE "task_dependency_tickets" t
     SET "status" = target,
         "resolvedAt" = CASE WHEN target = 'open' THEN NULL ELSE COALESCE(t."resolvedAt", now()) END,
         "cancelledAt" = CASE WHEN target = 'cancelled' THEN COALESCE(t."cancelledAt", now()) ELSE NULL END,
         "cancelledByUserId" = CASE WHEN target = 'cancelled' THEN COALESCE(t."cancelledByUserId", NEW."junkedByUserId") ELSE NULL END,
         "cancelReason" = CASE WHEN target = 'cancelled' THEN COALESCE(t."cancelReason", 'Dependency task moved to Junk: ' || COALESCE(NEW."junkReason", '')) ELSE NULL END
   WHERE t.id = NEW."dependencyTicketId"
     AND t."status" <> target;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "TRG_project_tasks_sync_dependency_ticket"
  AFTER UPDATE ON "project_tasks"
  FOR EACH ROW
  WHEN (NEW."dependencyTicketId" IS NOT NULL AND OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION tracker_sync_dependency_ticket();

COMMIT;
