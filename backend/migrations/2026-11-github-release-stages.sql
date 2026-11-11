-- GitHub multi-stage release path (2026-11-11, approved by the user): a
-- repository can have an ordered list of stages (e.g. Dev -> Test ->
-- Training -> Production; Local is not tracked), each recognised by GitHub
-- environment names, deploy workflows (+ branches) or release tag patterns.
-- Every stage deploy is recorded, and each task named in it (TRK-<n> in the
-- commits / PR titles / branches) gets the date it reached that stage -
-- with or without a Resolution (only the production Release Log keeps the
-- Resolution rule). The P1 sign-off stage (per repository, default the
-- stage named Test) supplies the staging date that "staging" supplies
-- today. Behind its own switch, OFF; repositories without stages (e.g.
-- Insurance) keep today's staging/production rules unchanged. Additive.
--   github_settings."releaseStagesEnabled" (false) - the switch
--   github_repo_mappings."stages" ([]) - ordered stage list (JSON)
--   github_repo_mappings."p1StageKey" (NULL = default: Test, else the
--     stage before Production)
--   github_webhook_deliveries."stageName" - which stage a delivery matched
--   github_stage_deployments - one deploy to one stage
--   task_stage_progress - one task x repository x stage: first/last reached
-- Run once (the apply script skips it if github_stage_deployments exists).
-- Rollback: 2026-11-github-release-stages.down.sql.
BEGIN;

ALTER TABLE "github_settings" ADD COLUMN "releaseStagesEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "github_repo_mappings" ADD COLUMN "stages" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "github_repo_mappings" ADD COLUMN "p1StageKey" character varying(40) NULL;
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "stageName" character varying(60) NULL;

CREATE TABLE "github_stage_deployments" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "mappingId" integer NOT NULL,
  "stageKey" character varying(40) NOT NULL,
  "stageName" character varying(60) NOT NULL,
  "isProduction" boolean NOT NULL DEFAULT false,
  "sha" character varying(40) NULL,
  "version" character varying(100) NULL,
  "deployedAt" TIMESTAMP NOT NULL,
  "deliveryId" character varying(100) NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_github_stage_deployments" PRIMARY KEY ("id"),
  CONSTRAINT "FK_github_stage_deployments_mapping" FOREIGN KEY ("mappingId") REFERENCES "github_repo_mappings"("id") ON DELETE CASCADE
);
CREATE INDEX "IDX_github_stage_deployments_stage" ON "github_stage_deployments" ("tenantId", "mappingId", "stageKey", "deployedAt");

CREATE TABLE "task_stage_progress" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "mappingId" integer NOT NULL,
  "stageKey" character varying(40) NOT NULL,
  "stageName" character varying(60) NOT NULL,
  "firstReachedAt" TIMESTAMP NOT NULL,
  "lastReachedAt" TIMESTAMP NOT NULL,
  "firstVersion" character varying(100) NULL,
  "firstDeploymentId" integer NULL,
  CONSTRAINT "PK_task_stage_progress" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_task_stage_progress" UNIQUE ("taskId", "mappingId", "stageKey"),
  CONSTRAINT "FK_task_stage_progress_task" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_task_stage_progress_mapping" FOREIGN KEY ("mappingId") REFERENCES "github_repo_mappings"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_task_stage_progress_deployment" FOREIGN KEY ("firstDeploymentId") REFERENCES "github_stage_deployments"("id") ON DELETE SET NULL,
  CONSTRAINT "CHK_task_stage_progress_times" CHECK ("lastReachedAt" >= "firstReachedAt")
);
CREATE INDEX "IDX_task_stage_progress_task" ON "task_stage_progress" ("tenantId", "taskId");

COMMIT;
