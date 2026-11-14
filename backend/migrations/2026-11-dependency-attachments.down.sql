-- Rollback of 2026-11-dependency-attachments.sql. Drops the attachment
-- rows (the stored files stay in the bucket, unreferenced), the resolution
-- note / resolver columns and the switch, and puts the trigger function
-- back exactly as 2026-11-dependency-tasks.sql made it.
BEGIN;

DROP TABLE "task_dependency_ticket_attachments";

ALTER TABLE "task_dependency_tickets" DROP CONSTRAINT "CHK_task_dependency_tickets_resolved_via";
ALTER TABLE "task_dependency_tickets"
  DROP COLUMN "resolvedByUserId",
  DROP COLUMN "resolvedVia",
  DROP COLUMN "resolutionNote";

ALTER TABLE "projects" DROP COLUMN "dependencyAttachmentsEnabled";

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
         "cancelledAt" = CASE WHEN target = 'cancelled' THEN COALESCE(t."cancelledAt", now()) ELSE NULL END,
         "cancelledByUserId" = CASE WHEN target = 'cancelled' THEN COALESCE(t."cancelledByUserId", NEW."junkedByUserId") ELSE NULL END,
         "cancelReason" = CASE WHEN target = 'cancelled' THEN COALESCE(t."cancelReason", 'Dependency task moved to Junk: ' || COALESCE(NEW."junkReason", '')) ELSE NULL END
   WHERE t.id = NEW."dependencyTicketId"
     AND t."status" <> target;
  RETURN NULL;
END;
$$;

COMMIT;
