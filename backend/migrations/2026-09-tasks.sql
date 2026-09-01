-- Task: a granular work item required through the full Project -> Module
-- -> Phase -> Sprint chain (all four mandatory, unlike Issue where each
-- is optional). task_status_percent_config is the admin-editable
-- status -> %complete mapping TasksService.withComputedFields() reads
-- per tenant - seeded here with the defaults confirmed with the user so
-- the app never has to hardcode them.

CREATE TABLE "project_tasks" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "projectName" character varying NOT NULL,
  "moduleId" integer NOT NULL,
  "moduleName" character varying NOT NULL,
  "phaseId" integer NOT NULL,
  "phaseName" character varying NOT NULL,
  "sprintId" integer NOT NULL,
  "sprintName" character varying NOT NULL,
  "description" text NOT NULL,
  "assigneeUserId" integer NOT NULL,
  "assigneeEmail" character varying NOT NULL,
  "estimatedHours" numeric(5,2),
  "dueDate" date,
  "dependency" boolean NOT NULL DEFAULT false,
  "dependencyDescription" text,
  "dependencyOwnerUserId" integer,
  "dependencyOwnerEmail" character varying,
  "status" character varying,
  "feedbackLink" character varying,
  "createdByUserId" integer,
  "createdByEmail" character varying NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "project_tasks"
  ADD CONSTRAINT "FK_project_tasks_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE INDEX "IDX_project_tasks_tenant_project" ON "project_tasks" ("tenantId", "projectId");
CREATE INDEX "IDX_project_tasks_tenant_assignee" ON "project_tasks" ("tenantId", "assigneeUserId");

CREATE TABLE "task_status_percent_config" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "status" character varying NOT NULL,
  "percent" integer NOT NULL,
  "updatedByUserId" integer,
  "updatedByEmail" character varying,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "task_status_percent_config"
  ADD CONSTRAINT "FK_task_status_percent_config_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "IDX_task_status_percent_config_tenant_status" ON "task_status_percent_config" ("tenantId", "status");

-- Seed defaults for every tenant that already exists - matches
-- TASK_STATUS_PERCENT_DEFAULTS in task-status-percent.entity.ts exactly.
INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", v."status", v."percent"
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('To Do', 0),
    ('In Progress', 0),
    ('Ready for Feedback', 50),
    ('Feedback Pass', 90),
    ('Feedback Failed', 0),
    ('Released - No Showstoppers', 100),
    ('Released - With Showstoppers', 0)
) AS v("status", "percent");
