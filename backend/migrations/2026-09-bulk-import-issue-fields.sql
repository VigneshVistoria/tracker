-- Bulk import/export for Issues (Admin/Program-Manager-only spreadsheet
-- tool): adds Estimated Hours, Due Date, Target Date, and a free-text
-- Dependency + Dependency Owner pair to Issue. None of these existed
-- anywhere on the entity or in any prior migration - confirmed by grep
-- across backend/src and backend/migrations before writing this. Only
-- IssuesBulkService writes these columns for now; the single-ticket
-- create/edit UI is untouched.
--
-- dueDate/targetDate are manually-entered business deadlines, distinct
-- from SlaService's computed-on-the-fly `sla.dueAt` (never persisted as a
-- column) - no naming collision, kept as separate concepts on purpose.
--
-- Verified by generating this from TypeORM's own schema-diff tool against
-- a local Postgres 15 instance seeded with the schema as it existed before
-- this change (via synchronize against the unmodified entities), then
-- re-running the diff tool afterward and confirming zero remaining
-- changes - same process as Phase 0/1's migrations.

BEGIN;

ALTER TABLE "issues" ADD "estimatedHours" numeric(6,2);
ALTER TABLE "issues" ADD "dueDate" date;
ALTER TABLE "issues" ADD "targetDate" date;
ALTER TABLE "issues" ADD "dependencyText" text;
ALTER TABLE "issues" ADD "dependencyOwnerUserId" integer;
ALTER TABLE "issues" ADD "dependencyOwnerEmail" character varying;

COMMIT;
