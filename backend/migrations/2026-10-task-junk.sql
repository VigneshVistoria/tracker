-- Junk state for tickets created by mistake (2026-10-09, confirmed with
-- the user). Reuses the existing 'Junk' status value; these columns record
-- who/when/why and the status to restore to. Nothing is ever deleted -
-- see ProjectTask.statusBeforeJunk and TasksService.markJunk()/restoreJunk().
-- Additive and nullable only, so the running app is unaffected before and
-- after the deploy.
BEGIN;
ALTER TABLE "project_tasks"
  ADD COLUMN "statusBeforeJunk" character varying,
  ADD COLUMN "junkReason" text,
  ADD COLUMN "junkedAt" TIMESTAMP,
  ADD COLUMN "junkedByUserId" integer,
  ADD COLUMN "junkedByEmail" character varying;

-- Tickets already closed as Junk from Interventions (only possible from
-- 'Escalated') - fill in who/when from their audit entry so they show in
-- the Junk list and can be restored back to Escalated.
UPDATE "project_tasks" t
SET "statusBeforeJunk" = 'Escalated',
    "junkedAt" = a."createdAt",
    "junkedByUserId" = a."userId",
    "junkedByEmail" = a."userEmail",
    "junkReason" = 'Closed as Junk from Interventions (no reason was recorded at the time)'
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "userId", "userEmail"
  FROM "audit_logs"
  WHERE "action" = 'task_escalation_closed_junk' AND "entityType" = 'ProjectTask'
  ORDER BY "entityId", "createdAt" DESC
) a
WHERE t."id" = a."entityId" AND t."status" = 'Junk';

-- Defensive: any Junk row with no audit entry still gets a restore target.
UPDATE "project_tasks"
SET "statusBeforeJunk" = 'Escalated',
    "junkedAt" = "updatedAt",
    "junkReason" = 'Closed as Junk from Interventions (no reason was recorded at the time)'
WHERE "status" = 'Junk' AND "statusBeforeJunk" IS NULL;
COMMIT;
