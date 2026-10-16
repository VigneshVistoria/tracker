-- Project Timeline Stage B (2026-10-16, confirmed with the user):
-- "Phase B starts after phase A" links between rows of one project's
-- plan. Finish-to-start only, with an optional gap in calendar days
-- (lagDays). Links may cross modules. PM/Admin add and remove them;
-- Executive views. Moving a phase never moves its dependants by itself -
-- the page shows the conflict and offers to shift them. A row deleted
-- from the plan takes its links with it (ON DELETE CASCADE). One new
-- table - nothing existing is altered.
--
-- Run after ./db-backup.sh. All or nothing (BEGIN/COMMIT).
BEGIN;
CREATE TABLE "project_timeline_dependencies" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "predecessorRowId" integer NOT NULL REFERENCES "project_timeline_rows"("id") ON DELETE CASCADE,
  "successorRowId" integer NOT NULL REFERENCES "project_timeline_rows"("id") ON DELETE CASCADE,
  "lagDays" integer NOT NULL DEFAULT 0,
  "createdByUserId" integer,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "CHK_project_timeline_dependencies_self" CHECK ("predecessorRowId" <> "successorRowId"),
  CONSTRAINT "CHK_project_timeline_dependencies_lag" CHECK ("lagDays" BETWEEN 0 AND 365),
  CONSTRAINT "UQ_project_timeline_dependencies_pair" UNIQUE ("predecessorRowId", "successorRowId")
);
CREATE INDEX "IDX_project_timeline_dependencies_project" ON "project_timeline_dependencies" ("tenantId", "projectId");
COMMIT;
