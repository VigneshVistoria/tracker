DROP INDEX "IDX_project_tasks_tenant_parent";
ALTER TABLE "project_tasks" DROP CONSTRAINT "FK_project_tasks_parent_task";
ALTER TABLE "project_tasks" DROP COLUMN "parentTaskId";
