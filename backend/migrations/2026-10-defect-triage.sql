-- Defect classification + developer triage, Stage 1 (2026-10-27, confirmed
-- with the user). See backend/src/tasks/defect-triage.ts.
-- Additive only: every new column is nullable or has a default, and the
-- switch is OFF for every project (defectTriageEnabled = false), so nothing
-- changes until a project is switched on in Admin -> Defect Triage Settings.
--   projects."defectTriageEnabled" - the per-project switch.
--   project_tasks - the defect's classification (severity, type, origin,
--     build, environment; each kept as the text picked, so editing a list
--     never changes history) and "triageStatus" (null = triage does not
--     apply, 'pending', 'accepted', 'disputed').
--   defect_triages - one row per defect per assignee: the 1-working-day
--     triage clock, the developer's Accept/Dispute and the PM's decision.
--   team_settings."defectTriageSettings" - the editable lists and rules;
--     '{}' means "never saved, use the defaults".
--   task_status_percent_config - the % Complete row for the new status
--     'Disputed', for every tenant (0%, like PM Feedback).
-- Safe to run twice. Rollback: 2026-10-defect-triage.down.sql.
BEGIN;

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "defectTriageEnabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "severity" character varying(100) NULL,
  ADD COLUMN IF NOT EXISTS "defectType" character varying(100) NULL,
  ADD COLUMN IF NOT EXISTS "defectOrigin" character varying(100) NULL,
  ADD COLUMN IF NOT EXISTS "foundInBuild" character varying(100) NULL,
  ADD COLUMN IF NOT EXISTS "foundInEnvironment" character varying(100) NULL,
  ADD COLUMN IF NOT EXISTS "triageStatus" character varying(20) NULL;

ALTER TABLE "team_settings" ADD COLUMN IF NOT EXISTS "defectTriageSettings" jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "defect_triages" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "assigneeUserId" integer NOT NULL,
  "assigneeEmail" character varying NOT NULL,
  "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "dueDate" date NOT NULL,
  "decision" character varying(20) NULL,
  "decidedAt" TIMESTAMP NULL,
  "disputeReason" character varying(100) NULL,
  "disputeComment" text NULL,
  "duplicateOfTaskId" integer NULL,
  "lateExempt" boolean NOT NULL DEFAULT false,
  "pmDecision" character varying(20) NULL,
  "pmComment" text NULL,
  "pmDecidedAt" TIMESTAMP NULL,
  "pmDecidedByUserId" integer NULL,
  "pmDecidedByEmail" character varying NULL,
  "reassignedToUserId" integer NULL,
  "convertedTaskId" integer NULL,
  "reminderSentAt" TIMESTAMP NULL,
  CONSTRAINT "FK_defect_triages_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_defect_triages_task" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id"),
  CONSTRAINT "FK_defect_triages_assignee" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id")
);
CREATE INDEX IF NOT EXISTS "IDX_defect_triages_task" ON "defect_triages" ("taskId", "id");
CREATE INDEX IF NOT EXISTS "IDX_defect_triages_assignee" ON "defect_triages" ("tenantId", "assigneeUserId", "startedAt");

INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Disputed', 0
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Disputed'
);

COMMIT;
