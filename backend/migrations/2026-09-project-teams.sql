-- ProjectTeam: a Team scoped to exactly one Project (unique per Project,
-- not tenant-wide). Distinct from the standalone `teams` catalog
-- (backend/src/teams) - that one stays untouched, this is a new, separate
-- table. Project Planning's Team field is repointed at this table (see
-- below); it previously searched the tenant-wide `teams` catalog with no
-- Project scoping at all.
CREATE TABLE "project_teams" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "projectName" character varying NOT NULL,
  "name" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'Active',
  "createdByUserId" integer,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "project_teams"
  ADD CONSTRAINT "FK_project_teams_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "IDX_project_teams_project_name" ON "project_teams" ("projectId", "name");
CREATE INDEX "IDX_project_teams_tenant_project" ON "project_teams" ("tenantId", "projectId");

-- project_plan_entries.teamId/teamName already exist (see
-- 2026-09-issue-categories-teams-labels.sql) and previously referenced the
-- tenant-wide `teams` catalog informationally. No column change needed -
-- existing rows keep their denormalized teamName text for display; going
-- forward the app resolves teamId against project_teams instead. Existing
-- teamId values (if any) may point at the old `teams` table rather than a
-- row here - harmless, since Team was always informational only (Issue has
-- no teamId, so it never narrows the completion query) and the UI always
-- displays the stored teamName text rather than re-resolving the id.
