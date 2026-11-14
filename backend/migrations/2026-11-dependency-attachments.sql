-- Dependency attachments, Stage 1 (feature request from Salman 2026-11-02,
-- decisions from the user 2026-11-13). Files on dependency tickets: the
-- requester attaches files when raising, whoever resolves attaches files
-- with an optional resolution note. Behind its own per-project switch
-- (default OFF), separate from "Dependency tasks".
--
--  * projects."dependencyAttachmentsEnabled" - the per-project switch.
--  * task_dependency_tickets: who resolved it ("resolvedByUserId", always
--    recorded from now on), how ("resolvedVia": 'ticket' = the Resolve
--    button, 'linked_task' = its dependency task was closed/passed/released
--    elsewhere) and the optional "resolutionNote". All three are cleared
--    when the ticket is reopened. Older resolved tickets stay NULL.
--  * task_dependency_ticket_attachments - one row per file; the bytes are
--    in the existing private storage bucket, served only by the backend.
--  * tracker_sync_dependency_ticket() (the trigger from 2026-11-dependency-
--    tasks.sql) also writes "resolvedVia" = 'linked_task' when it resolves a
--    ticket, and clears the three columns when it reopens one. The person
--    and date for the "Auto-resolved" note come from task_status_events.
-- Rollback: 2026-11-dependency-attachments.down.sql.
BEGIN;

ALTER TABLE "projects" ADD COLUMN "dependencyAttachmentsEnabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "task_dependency_tickets"
  ADD COLUMN "resolvedByUserId" integer NULL,
  ADD COLUMN "resolvedVia" varchar(20) NULL,
  ADD COLUMN "resolutionNote" text NULL;
ALTER TABLE "task_dependency_tickets" ADD CONSTRAINT "CHK_task_dependency_tickets_resolved_via"
  CHECK ("resolvedVia" IS NULL OR "resolvedVia" IN ('ticket', 'linked_task'));

CREATE TABLE "task_dependency_ticket_attachments" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "ticketId" integer NOT NULL REFERENCES "task_dependency_tickets"("id") ON DELETE RESTRICT,
  "side" varchar(20) NOT NULL CHECK ("side" IN ('request', 'resolution')),
  "uploadedByUserId" integer NOT NULL,
  "fileName" varchar(200) NOT NULL,
  "mimeType" varchar(100) NOT NULL,
  "sizeBytes" integer NOT NULL,
  "storageKey" varchar(300) NOT NULL UNIQUE,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "IDX_task_dependency_ticket_attachments_ticket" ON "task_dependency_ticket_attachments" ("tenantId", "ticketId");

-- Same as 2026-11-dependency-tasks.sql plus the three new columns.
-- MUST match DEPENDENCY_TASK_RESOLVED_STATUSES / DEPENDENCY_TASK_CANCELLED_STATUS
-- in backend/src/task-dependency-tickets/dependency-tasks.ts - a test checks.
CREATE OR REPLACE FUNCTION tracker_sync_dependency_ticket() RETURNS trigger
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
         "resolvedVia" = CASE WHEN target = 'resolved' THEN 'linked_task' ELSE NULL END,
         "resolvedByUserId" = NULL,
         "resolutionNote" = NULL,
         "cancelledAt" = CASE WHEN target = 'cancelled' THEN COALESCE(t."cancelledAt", now()) ELSE NULL END,
         "cancelledByUserId" = CASE WHEN target = 'cancelled' THEN COALESCE(t."cancelledByUserId", NEW."junkedByUserId") ELSE NULL END,
         "cancelReason" = CASE WHEN target = 'cancelled' THEN COALESCE(t."cancelReason", 'Dependency task moved to Junk: ' || COALESCE(NEW."junkReason", '')) ELSE NULL END
   WHERE t.id = NEW."dependencyTicketId"
     AND t."status" <> target;
  RETURN NULL;
END;
$$;

COMMIT;
