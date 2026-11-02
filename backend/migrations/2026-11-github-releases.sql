-- Performance Tracking P1/P2 from GitHub (2026-11-02, the user's
-- decisions): a GitHub App sends deployment, workflow run and release
-- events; Tracker creates or fills in Release Log entries. Behind a switch,
-- OFF. See backend/src/github-releases/github-releases.ts. Additive only.
--   github_settings - one row per tenant: the switch (OFF) and the task key
--     prefix (TRK). No row = defaults.
--   github_repo_mappings - a repository -> Tracker project + app name, and
--     which environments / workflow branches / release kinds are staging
--     or production.
--   github_webhook_deliveries - every delivery, signed or not: event,
--     repository, outcome and reason. A summary only, never the payload.
--     Rows older than 90 days are pruned by the app.
--   github_staging_deployments - each staging deployment seen (commit,
--     version, when), used to suggest the staging date on the release.
--   releases: "source" (manual/github), the GitHub repository, commit and
--     delivery, the GitHub user who released (kept even when they aren't
--     mapped to a Tracker user), the staging deployment date GitHub saw
--     (a suggestion - the PM still records who signed off, so P1 is
--     unchanged), the fields GitHub filled, and notes for the PM (tasks
--     skipped and why).
--   users."githubLogin" - the person's GitHub username (Admin sets it),
--     unique per tenant ignoring case.
-- Run once (the apply script skips it if github_settings already exists).
-- Rollback: 2026-11-github-releases.down.sql.
BEGIN;

CREATE TABLE "github_settings" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "taskKeyPrefix" character varying(10) NOT NULL DEFAULT 'TRK',
  "updatedByUserId" integer NULL,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_github_settings" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_github_settings_prefix" CHECK ("taskKeyPrefix" ~ '^[A-Z][A-Z0-9]{1,9}$')
);
CREATE UNIQUE INDEX "UQ_github_settings_tenant" ON "github_settings" ("tenantId");

CREATE TABLE "github_repo_mappings" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "repoFullName" character varying(200) NOT NULL,
  "projectId" integer NOT NULL,
  "appName" character varying(255) NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "stagingEnvironments" jsonb NOT NULL DEFAULT '["staging"]',
  "productionEnvironments" jsonb NOT NULL DEFAULT '["production"]',
  "deployWorkflows" jsonb NOT NULL DEFAULT '[]',
  "stagingBranches" jsonb NOT NULL DEFAULT '[]',
  "productionBranches" jsonb NOT NULL DEFAULT '[]',
  "publishedReleaseIs" character varying(10) NOT NULL DEFAULT 'production',
  "preReleaseIs" character varying(10) NOT NULL DEFAULT 'staging',
  "createdByUserId" integer NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_github_repo_mappings" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_github_repo_mappings_kinds" CHECK ("publishedReleaseIs" IN ('production', 'staging', 'ignore') AND "preReleaseIs" IN ('production', 'staging', 'ignore'))
);
-- A repository maps to one tenant and project (case-insensitive, as GitHub).
CREATE UNIQUE INDEX "UQ_github_repo_mappings_repo" ON "github_repo_mappings" (lower("repoFullName"));

CREATE TABLE "github_webhook_deliveries" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NULL,
  "deliveryId" character varying(100) NULL,
  "event" character varying(50) NULL,
  "action" character varying(50) NULL,
  "repoFullName" character varying(200) NULL,
  "signatureValid" boolean NOT NULL,
  "outcome" character varying(12) NOT NULL,
  "reason" text NULL,
  "environment" character varying(12) NULL,
  "releaseId" integer NULL,
  "receivedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "processedAt" TIMESTAMP NULL,
  CONSTRAINT "PK_github_webhook_deliveries" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_github_webhook_deliveries_outcome" CHECK ("outcome" IN ('received', 'processed', 'ignored', 'refused', 'duplicate', 'error')),
  CONSTRAINT "CHK_github_webhook_deliveries_env" CHECK ("environment" IS NULL OR "environment" IN ('staging', 'production'))
);
CREATE INDEX "IDX_github_webhook_deliveries_received" ON "github_webhook_deliveries" ("receivedAt");
CREATE INDEX "IDX_github_webhook_deliveries_delivery" ON "github_webhook_deliveries" ("deliveryId");

CREATE TABLE "github_staging_deployments" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "mappingId" integer NOT NULL,
  "sha" character varying(40) NULL,
  "version" character varying(100) NULL,
  "deployedAt" TIMESTAMP NOT NULL,
  "deliveryId" character varying(100) NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_github_staging_deployments" PRIMARY KEY ("id")
);
CREATE INDEX "IDX_github_staging_deployments_mapping" ON "github_staging_deployments" ("tenantId", "mappingId", "deployedAt");

ALTER TABLE "releases" ADD COLUMN "source" character varying(10) NOT NULL DEFAULT 'manual';
ALTER TABLE "releases" ADD CONSTRAINT "CHK_releases_source" CHECK ("source" IN ('manual', 'github'));
ALTER TABLE "releases" ADD COLUMN "githubRepo" character varying(200) NULL;
ALTER TABLE "releases" ADD COLUMN "githubSha" character varying(40) NULL;
ALTER TABLE "releases" ADD COLUMN "githubDeliveryId" character varying(100) NULL;
ALTER TABLE "releases" ADD COLUMN "githubReleasedByLogin" character varying(100) NULL;
ALTER TABLE "releases" ADD COLUMN "githubStagingDeployedOn" date NULL;
ALTER TABLE "releases" ADD COLUMN "githubFilled" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "releases" ADD COLUMN "githubNotes" jsonb NOT NULL DEFAULT '[]';

ALTER TABLE "users" ADD COLUMN "githubLogin" character varying(100) NULL;
ALTER TABLE "users" ADD CONSTRAINT "CHK_users_github_login" CHECK ("githubLogin" IS NULL OR "githubLogin" ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$');
CREATE UNIQUE INDEX "UQ_users_github_login" ON "users" ("tenantId", lower("githubLogin")) WHERE "githubLogin" IS NOT NULL;

COMMIT;
