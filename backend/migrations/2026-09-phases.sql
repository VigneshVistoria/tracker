-- Phase: a real entity scoped to a Project + Module (more granular than
-- Sprint, which is Project-scoped only). Replaces Sprint's incidental use
-- as "Phase" on Project Planning entries - Sprint itself is untouched as
-- its own separate feature.
CREATE TABLE "phases" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "projectName" character varying NOT NULL,
  "moduleId" integer NOT NULL,
  "moduleName" character varying NOT NULL,
  "name" character varying NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdByUserId" integer,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "phases"
  ADD CONSTRAINT "FK_phases_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "IDX_phases_module_name" ON "phases" ("moduleId", "name");
CREATE INDEX "IDX_phases_tenant_project" ON "phases" ("tenantId", "projectId");

-- Issue gains a phase-level link, mirroring moduleId - without this,
-- Phase's %Complete would have no data to ever compute from.
ALTER TABLE "issues" ADD COLUMN "phaseId" integer;
ALTER TABLE "issues" ADD COLUMN "phaseName" character varying;

-- Project Planning's "Phase" field previously pointed at Sprint (a
-- stand-in before this entity existed) - zero existing rows have either
-- column set, so this is a safe, clean rename to the real thing.
ALTER TABLE "project_plan_entries" RENAME COLUMN "sprintId" TO "phaseId";
ALTER TABLE "project_plan_entries" RENAME COLUMN "sprintName" TO "phaseName";
