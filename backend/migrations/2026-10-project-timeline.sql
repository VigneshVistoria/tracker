-- Project Timeline (2026-10-16): a per-project plan the PM imports from a
-- CSV/Excel file and then edits (Module, Phase, Team, Status, Start Date,
-- End Date). Two new tables - nothing existing is altered. Separate from
-- the older Project Planning feature (project_plan_entries) and from the
-- Module/Phase master: Module and Phase are plain text here, so nothing
-- in this plan shows up in task/issue pickers.
--
-- Run after ./db-backup.sh. All or nothing (BEGIN/COMMIT): if either
-- table already exists the file fails and changes nothing.
BEGIN;

-- The managed Team list (Amanah, Vistoria, ...). Tenant-wide, not tied to
-- the clients table or project_teams.
CREATE TABLE "project_timeline_teams" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "name" character varying(100) NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdByUserId" integer,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_project_timeline_teams_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
);
CREATE UNIQUE INDEX "UQ_project_timeline_teams_name" ON "project_timeline_teams" ("tenantId", lower("name"));

-- One row per Module + Phase of a project's plan. "matchKey" is the
-- lower-cased, space-collapsed "module|phase" the app computes - re-uploads
-- match on it, and the unique constraint makes a duplicate impossible even
-- if two saves race. DEFERRABLE so one save can swap two rows' names.
CREATE TABLE "project_timeline_rows" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "module" character varying(200) NOT NULL,
  "phase" character varying(300) NOT NULL,
  "matchKey" character varying(520) NOT NULL,
  "teamId" integer,
  "status" character varying(20) NOT NULL DEFAULT 'To Do',
  "startDate" date,
  "endDate" date,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1,
  "createdByUserId" integer,
  "createdByEmail" character varying,
  "updatedByUserId" integer,
  "updatedByEmail" character varying,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_project_timeline_rows_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_project_timeline_rows_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id"),
  CONSTRAINT "FK_project_timeline_rows_team" FOREIGN KEY ("teamId") REFERENCES "project_timeline_teams"("id"),
  CONSTRAINT "CHK_project_timeline_rows_status" CHECK ("status" IN ('To Do', 'In Progress', 'Completed', 'Delayed', 'On Hold')),
  CONSTRAINT "CHK_project_timeline_rows_dates" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate"),
  CONSTRAINT "UQ_project_timeline_rows_match" UNIQUE ("tenantId", "projectId", "matchKey") DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "IDX_project_timeline_rows_project" ON "project_timeline_rows" ("tenantId", "projectId", "sortOrder");

-- Starting Team list for every existing tenant (production has one).
INSERT INTO "project_timeline_teams" ("tenantId", "name")
SELECT t."id", n."name" FROM "tenants" t CROSS JOIN (VALUES ('Amanah'), ('Vistoria')) AS n("name");

COMMIT;
