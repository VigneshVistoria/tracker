-- Task Lifecycle redesign: Backlog (PM creates, no assignee) -> Assignment
-- (PM assigns, singly or bulk) -> My Tasks (Assignee sets E.Hrs/Due Date/
-- Status) -> Dependency Ticket (Assignee-initiated, own table instead of
-- the old inline dependency/dependencyDescription/dependencyOwner* flag
-- fields on project_tasks). Sprint is dropped from the Task chain -
-- Project/Module/Phase only, matching Project Planning's Phase-replaces-
-- Sprint change.

-- 1. Assignee becomes optional - a task with no assignee is "in Backlog".
ALTER TABLE "project_tasks" ALTER COLUMN "assigneeUserId" DROP NOT NULL;
ALTER TABLE "project_tasks" ALTER COLUMN "assigneeEmail" DROP NOT NULL;

-- 2. New first-class Dependency Ticket table, scoped to Tasks (deliberately
-- separate from the Issue-oriented "dependencies" table/workflow).
CREATE TABLE "task_dependency_tickets" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "parentTaskId" integer NOT NULL,
  "description" text NOT NULL,
  "ownerUserId" integer NOT NULL,
  "ownerEmail" character varying NOT NULL,
  "createdByUserId" integer,
  "createdByEmail" character varying NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "task_dependency_tickets"
  ADD CONSTRAINT "FK_task_dependency_tickets_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");
ALTER TABLE "task_dependency_tickets"
  ADD CONSTRAINT "FK_task_dependency_tickets_parent_task" FOREIGN KEY ("parentTaskId") REFERENCES "project_tasks"("id");

CREATE INDEX "IDX_task_dependency_tickets_tenant_parent" ON "task_dependency_tickets" ("tenantId", "parentTaskId");
CREATE INDEX "IDX_task_dependency_tickets_tenant_owner" ON "task_dependency_tickets" ("tenantId", "ownerUserId");

-- 3. Backfill: any existing task that already had the old inline
-- dependency flag set becomes a real Dependency Ticket row, so it still
-- shows up in the new owner's Dependency Clearance inbox instead of
-- silently vanishing when the old columns are dropped below.
INSERT INTO "task_dependency_tickets"
  ("tenantId", "parentTaskId", "description", "ownerUserId", "ownerEmail", "createdByUserId", "createdByEmail", "createdAt")
SELECT "tenantId", "id", "dependencyDescription", "dependencyOwnerUserId", "dependencyOwnerEmail", "createdByUserId", "createdByEmail", "createdAt"
FROM "project_tasks"
WHERE "dependency" = true
  AND "dependencyDescription" IS NOT NULL
  AND "dependencyOwnerUserId" IS NOT NULL;

-- 4. Drop Sprint and the old inline dependency fields from project_tasks -
-- fully superseded by task_dependency_tickets above.
ALTER TABLE "project_tasks" DROP COLUMN "sprintId";
ALTER TABLE "project_tasks" DROP COLUMN "sprintName";
ALTER TABLE "project_tasks" DROP COLUMN "dependency";
ALTER TABLE "project_tasks" DROP COLUMN "dependencyDescription";
ALTER TABLE "project_tasks" DROP COLUMN "dependencyOwnerUserId";
ALTER TABLE "project_tasks" DROP COLUMN "dependencyOwnerEmail";
