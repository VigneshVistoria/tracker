-- Adds project_tasks.parentTaskId, nullable, set only when a defect was
-- spun off a QA rejection via the "Create linked defect" option
-- (TaskQaReviewsService.reject() -> TasksService.createDefect()). Every
-- existing defect row keeps parentTaskId NULL (standalone, unchanged
-- behavior) - nothing backfills this column. Self-referencing FK onto
-- project_tasks itself, same shape as task_dependency_tickets.parentTaskId
-- (2026-09-task-lifecycle.sql) but kept on this table since a defect is
-- already just a ProjectTask row with isDefect=true, not a separate
-- entity. See ProjectTask.parentTaskId and
-- TasksService.assertNoOpenLinkedDefects()/findLinkedDefectsForTask().
ALTER TABLE "project_tasks" ADD COLUMN "parentTaskId" integer;

ALTER TABLE "project_tasks"
  ADD CONSTRAINT "FK_project_tasks_parent_task" FOREIGN KEY ("parentTaskId") REFERENCES "project_tasks"("id");

CREATE INDEX "IDX_project_tasks_tenant_parent" ON "project_tasks" ("tenantId", "parentTaskId");
