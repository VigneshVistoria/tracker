-- Project Timeline Stage C (2026-10-16, confirmed with the user): link a
-- timeline phase to the tickets that deliver it, so its progress comes
-- from real tickets. Two kinds of link per phase:
--   * by app Module (+ optional Phase): every ticket in that module/phase
--     of the same project counts, including tickets created later;
--   * by one ticket (taskId).
-- Tickets are only read - nothing here changes a ticket. PM/Admin add and
-- remove links (audited); Executive views. A deleted phase, module, app
-- phase or ticket takes its links with it. One new table - nothing
-- existing is altered.
--
-- Run after ./db-backup.sh. All or nothing (BEGIN/COMMIT).
BEGIN;
CREATE TABLE "project_timeline_ticket_links" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "rowId" integer NOT NULL REFERENCES "project_timeline_rows"("id") ON DELETE CASCADE,
  "moduleId" integer REFERENCES "modules"("id") ON DELETE CASCADE,
  "phaseId" integer REFERENCES "phases"("id") ON DELETE CASCADE,
  "taskId" integer REFERENCES "project_tasks"("id") ON DELETE CASCADE,
  "createdByUserId" integer,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  -- Either one ticket, or a module (with or without a phase) - never both.
  CONSTRAINT "CHK_project_timeline_ticket_links_kind" CHECK (
    ("taskId" IS NOT NULL AND "moduleId" IS NULL AND "phaseId" IS NULL)
    OR ("taskId" IS NULL AND "moduleId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "UQ_project_timeline_ticket_links_task" ON "project_timeline_ticket_links" ("rowId", "taskId") WHERE "taskId" IS NOT NULL;
CREATE UNIQUE INDEX "UQ_project_timeline_ticket_links_module" ON "project_timeline_ticket_links" ("rowId", "moduleId", COALESCE("phaseId", 0)) WHERE "taskId" IS NULL;
CREATE INDEX "IDX_project_timeline_ticket_links_project" ON "project_timeline_ticket_links" ("tenantId", "projectId");
COMMIT;
