-- QA/Program Manager can link an existing Defect as blocking a Task
-- (TaskBlockingDefect). While any linked defect is unresolved (not Pass/
-- Junk/Closed), the Task can't be submitted for QA - see
-- TasksService.assertNoOpenLinkedDefects(). Purely additive.
BEGIN;
CREATE TABLE "task_blocking_defects" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "defectId" integer NOT NULL,
  "linkedByUserId" integer,
  "linkedByEmail" character varying NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "task_blocking_defects"
  ADD CONSTRAINT "FK_task_blocking_defects_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");
ALTER TABLE "task_blocking_defects"
  ADD CONSTRAINT "FK_task_blocking_defects_task" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE CASCADE;
ALTER TABLE "task_blocking_defects"
  ADD CONSTRAINT "FK_task_blocking_defects_defect" FOREIGN KEY ("defectId") REFERENCES "project_tasks"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "IDX_task_blocking_defects_task_defect" ON "task_blocking_defects" ("taskId", "defectId");
CREATE INDEX "IDX_task_blocking_defects_defect" ON "task_blocking_defects" ("defectId");
COMMIT;
