-- Adds project_tasks.priority (Immediate/High/Medium), nullable with no
-- default - existing rows stay NULL ("Not Set") until a Program Manager
-- reviews and sets one by hand; nothing backfills a value. See
-- ProjectTask.priority and TasksService's PRIORITY_MUTATE_ROLES check.
CREATE TYPE "public"."project_tasks_priority_enum" AS ENUM('Immediate', 'High', 'Medium');
ALTER TABLE "project_tasks" ADD COLUMN "priority" "public"."project_tasks_priority_enum";
