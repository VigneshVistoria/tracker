-- Performance Tracking, Wave 1 Stage S2 - committed Due date and change
-- requests (2026-10-28, decisions from the user). See
-- backend/src/tasks/due-date-change.ts. Additive only: with a project's
-- switch OFF nothing behaves differently.
--   project_tasks."dueDateCommittedByUserId" / "dueDateCommittedAt" - the
--     assignee whose own Due date is the commitment, and when they made it.
--     NULL, or a different user from the current assignee (after a
--     reassignment, or a date the PM set), means the current assignee has
--     not committed yet: with tracking ON they get ONE free set or
--     confirmation, then it locks.
--   due_date_change_requests - every change to a committed date while
--     tracking is ON: the assignee's requests (pending until a PM or Admin
--     approves or rejects; the old date stays meanwhile) and PM/Admin
--     direct changes (kind 'direct', approved at once, reason required).
--
-- Backfill: every task that already has a Due date and an assignee counts
-- as committed by its current assignee - existing tasks keep today's lock.
--
-- A trigger on project_tasks cancels a pending request when the task is
-- reassigned or moves to Pass, Junk, Hold, Closed or Released, whatever the
-- code path. It is fail-safe (WARNING, never fails the change).
-- Run once (the apply script skips it if the table already exists).
-- Rollback: 2026-10-performance-tracking-due-date-commitment.down.sql.
BEGIN;

ALTER TABLE "project_tasks" ADD COLUMN "dueDateCommittedByUserId" integer NULL;
ALTER TABLE "project_tasks" ADD COLUMN "dueDateCommittedAt" TIMESTAMP NULL;

UPDATE "project_tasks" t
   SET "dueDateCommittedByUserId" = t."assigneeUserId",
       "dueDateCommittedAt" = COALESCE(
         (SELECT max(e."occurredAt") FROM "task_commitment_events" e
           WHERE e."taskId" = t.id AND e."kind" IN ('due_set', 'due_changed')),
         t."updatedAt")
 WHERE t."dueDate" IS NOT NULL AND t."assigneeUserId" IS NOT NULL;

CREATE TABLE "due_date_change_requests" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "kind" character varying(10) NOT NULL,
  "assigneeUserId" integer,
  "requestedByUserId" integer NOT NULL,
  "currentDueDate" date NOT NULL,
  "requestedDueDate" date NOT NULL,
  "reason" text NOT NULL,
  "status" character varying(20) NOT NULL,
  "decidedByUserId" integer,
  "decidedAt" TIMESTAMP,
  "decisionNote" text,
  "cancelReason" character varying(60),
  "auditLogId" integer,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_due_date_change_requests" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_due_date_change_requests_kind" CHECK ("kind" IN ('request', 'direct')),
  CONSTRAINT "CHK_due_date_change_requests_status" CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled'))
);
CREATE INDEX "IDX_due_date_change_requests_tenant_task" ON "due_date_change_requests" ("tenantId", "taskId");
CREATE INDEX "IDX_due_date_change_requests_tenant_status" ON "due_date_change_requests" ("tenantId", "status");
-- At most one pending request per task.
CREATE UNIQUE INDEX "UQ_due_date_change_requests_pending" ON "due_date_change_requests" ("taskId") WHERE "status" = 'pending';

-- Keep the status list in step with DUE_DATE_FROZEN_STATUSES in
-- src/tasks/due-date-change.ts (a test checks).
CREATE FUNCTION tracker_cancel_due_date_requests() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    UPDATE "due_date_change_requests" r
       SET "status" = 'cancelled',
           "decidedAt" = now(),
           "cancelReason" = CASE
             WHEN NEW."assigneeUserId" IS DISTINCT FROM r."assigneeUserId" THEN 'reassigned'
             ELSE 'status:' || NEW."status" END
     WHERE r."taskId" = NEW.id
       AND r."status" = 'pending'
       AND (NEW."assigneeUserId" IS DISTINCT FROM r."assigneeUserId"
            OR NEW."status" IN ('Pass', 'Junk', 'Hold', 'Closed', 'Released - No Showstoppers', 'Released - With Showstoppers'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tracker_cancel_due_date_requests failed for task %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "TRG_project_tasks_cancel_due_date_requests"
  AFTER UPDATE ON "project_tasks"
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status" OR OLD."assigneeUserId" IS DISTINCT FROM NEW."assigneeUserId")
  EXECUTE FUNCTION tracker_cancel_due_date_requests();

COMMIT;
