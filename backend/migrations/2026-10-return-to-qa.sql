-- Return to QA (2026-10-18, confirmed with the user). Data only - no
-- table changes: the new status 'Returned to QA' is a plain value of
-- project_tasks.status, and who a ticket was returned to lives in its
-- audit entry. Adds the % Complete row for the new status, for every
-- tenant (same as the PM review gate's statuses). Safe to run twice.
-- See backend/src/tasks/return-to-qa.ts.
BEGIN;
INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Returned to QA', 0
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Returned to QA'
);
COMMIT;
