-- Project Planning: entries scoped to a Project (and optionally a
-- Module/Phase-as-Sprint/Team), timeline, and status. % complete is
-- computed live by the app from real Issues, not stored here.
CREATE TABLE "project_plan_entries" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "projectName" character varying NOT NULL,
  "moduleId" integer,
  "moduleName" character varying,
  "sprintId" integer,
  "sprintName" character varying,
  "teamId" integer,
  "teamName" character varying,
  "startDate" date NOT NULL,
  "targetDate" date NOT NULL,
  "status" character varying NOT NULL DEFAULT 'ToDo',
  "isActive" boolean NOT NULL DEFAULT true,
  "createdByUserId" integer,
  "createdByEmail" character varying NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "CHK_project_plan_entries_date_range" CHECK ("targetDate" >= "startDate")
);

ALTER TABLE "project_plan_entries"
  ADD CONSTRAINT "FK_project_plan_entries_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE INDEX "IDX_project_plan_entries_tenant_project" ON "project_plan_entries" ("tenantId", "projectId");
CREATE INDEX "IDX_project_plan_entries_tenant_status" ON "project_plan_entries" ("tenantId", "status");
