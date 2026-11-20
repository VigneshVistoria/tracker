-- Delivery log details (2026-11-20, requested by the user): for every
-- signed delivery, recorded or ignored, the GitHub user who triggered it,
-- the branch, the PR title or commit message (first line), the workflow
-- and the task numbers named in them. Still a summary - no payload.
--   github_webhook_deliveries."githubLogin", "branch", "title",
--     "workflowName" (nullable) and "taskIds" (jsonb list, default []).
-- Older deliveries keep these empty (their payloads were never stored).
-- Run once (the apply script skips it if taskIds already exists).
-- Rollback: 2026-11-github-delivery-log-details.down.sql.
BEGIN;
ALTER TABLE "github_webhook_deliveries"
  ADD COLUMN "githubLogin" varchar(100),
  ADD COLUMN "branch" varchar(255),
  ADD COLUMN "title" varchar(300),
  ADD COLUMN "workflowName" varchar(100),
  ADD COLUMN "taskIds" jsonb NOT NULL DEFAULT '[]';
COMMIT;
