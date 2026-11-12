-- Design handover (2026-11-12, Option A approved by the user): a designer
-- hands a design task to development. Additive only. See
-- backend/src/task-handovers/design-handovers.ts.
--   task_handovers.kind          'owner' (C4 handover, existing rows) or 'design'
--   task_handovers.artifacts     design links handed over [{type, url}]
--   task_handovers."linkedTaskId" the development task the developer linked or created on accept
--   project_tasks."designHandoverId" set on a design task closed by an accepted design handover
--   projects."designHandoverEnabled" per-project switch, default OFF (Admin / PM, audited)
-- Safe to run again (IF NOT EXISTS). Rollback: 2026-11-design-handover.down.sql.
BEGIN;
ALTER TABLE "task_handovers" ADD COLUMN IF NOT EXISTS "kind" character varying(10) NOT NULL DEFAULT 'owner';
ALTER TABLE "task_handovers" ADD COLUMN IF NOT EXISTS "artifacts" jsonb NULL;
ALTER TABLE "task_handovers" ADD COLUMN IF NOT EXISTS "linkedTaskId" integer NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_task_handovers_kind') THEN
    ALTER TABLE "task_handovers" ADD CONSTRAINT "CHK_task_handovers_kind" CHECK ("kind" IN ('owner', 'design'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "IDX_task_handovers_linked_task" ON "task_handovers" ("tenantId", "linkedTaskId") WHERE "linkedTaskId" IS NOT NULL;
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "designHandoverId" integer NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "designHandoverEnabled" boolean NOT NULL DEFAULT false;
COMMIT;
