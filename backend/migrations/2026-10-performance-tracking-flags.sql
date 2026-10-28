-- Performance Tracking, Wave 1 Stage S3 - risk and blocker flags, and a
-- needed-by date on dependency tickets (2026-10-28, decisions from the
-- user). See backend/src/task-flags/task-flags.ts. Additive only: with a
-- project's switch OFF nothing behaves differently.
--   task_flags - one row per flag, kept forever (full history). At most one
--     OPEN flag of each kind per task. "setByAssignee" records whether the
--     assignee raised it (only those count for D3 early warning and O1
--     blocker raise lag; PM/Admin flags are shown but give no credit).
--     "committedDueDateAtSet" is the task's Due date when the flag went up
--     (for D3). A blocker has a blocking owner: a tracker user, or an
--     outside party as text ("external" - not charged to any person).
--   task_dependency_tickets."needByDate" / "overdueAt" - the date the
--     creator needs it by (required while tracking is ON) and the instant
--     it becomes overdue (00:00 the next day in the team's time zone),
--     written by the code. Existing tickets stay undated.
--
-- A trigger on project_tasks clears open flags when the task moves to
-- Pass, Junk, Closed or Released, whatever the code path. It is fail-safe
-- (WARNING, never fails the change).
-- Run once (the apply script skips it if the table already exists).
-- Rollback: 2026-10-performance-tracking-flags.down.sql.
BEGIN;

CREATE TABLE "task_flags" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "kind" character varying(10) NOT NULL,
  "reason" text NOT NULL,
  "likelyDueDate" date,
  "blockingOwnerUserId" integer,
  "blockingOwnerExternal" character varying(200),
  "external" boolean NOT NULL DEFAULT false,
  "dependencyTicketId" integer,
  "assigneeUserId" integer,
  "committedDueDateAtSet" date,
  "setByUserId" integer NOT NULL,
  "setByAssignee" boolean NOT NULL,
  "setAt" TIMESTAMP NOT NULL DEFAULT now(),
  "clearedByUserId" integer,
  "clearedAt" TIMESTAMP,
  "clearNote" text,
  "clearReason" character varying(60),
  CONSTRAINT "PK_task_flags" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_task_flags_kind" CHECK ("kind" IN ('risk', 'blocker')),
  -- A risk has no owner or link; a blocker has exactly one owner, and
  -- "external" says which kind.
  CONSTRAINT "CHK_task_flags_owner" CHECK (
    ("kind" = 'risk' AND "blockingOwnerUserId" IS NULL AND "blockingOwnerExternal" IS NULL AND "dependencyTicketId" IS NULL AND NOT "external")
    OR ("kind" = 'blocker' AND "likelyDueDate" IS NULL AND (
         ("blockingOwnerUserId" IS NOT NULL AND "blockingOwnerExternal" IS NULL AND NOT "external")
      OR ("blockingOwnerUserId" IS NULL AND "blockingOwnerExternal" IS NOT NULL AND "external")))
  )
);
CREATE INDEX "IDX_task_flags_tenant_task" ON "task_flags" ("tenantId", "taskId");
CREATE INDEX "IDX_task_flags_tenant_open" ON "task_flags" ("tenantId") WHERE "clearedAt" IS NULL;
-- At most one open flag of each kind per task.
CREATE UNIQUE INDEX "UQ_task_flags_open" ON "task_flags" ("taskId", "kind") WHERE "clearedAt" IS NULL;

ALTER TABLE "task_dependency_tickets" ADD COLUMN "needByDate" date NULL;
ALTER TABLE "task_dependency_tickets" ADD COLUMN "overdueAt" TIMESTAMP NULL;

-- Keep the status list in step with FLAG_CLEARING_STATUSES in
-- src/task-flags/task-flags.ts (a test checks).
CREATE FUNCTION tracker_clear_task_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    UPDATE "task_flags"
       SET "clearedAt" = now(),
           "clearReason" = 'status:' || NEW."status"
     WHERE "taskId" = NEW.id
       AND "clearedAt" IS NULL
       AND NEW."status" IN ('Pass', 'Junk', 'Closed', 'Released - No Showstoppers', 'Released - With Showstoppers');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tracker_clear_task_flags failed for task %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "TRG_project_tasks_clear_task_flags"
  AFTER UPDATE ON "project_tasks"
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION tracker_clear_task_flags();

COMMIT;
