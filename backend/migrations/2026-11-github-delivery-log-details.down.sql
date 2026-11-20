-- Rollback for 2026-11-github-delivery-log-details.sql. Deploy the previous
-- code first (it doesn't read these columns).
BEGIN;
ALTER TABLE "github_webhook_deliveries"
  DROP COLUMN IF EXISTS "githubLogin",
  DROP COLUMN IF EXISTS "branch",
  DROP COLUMN IF EXISTS "title",
  DROP COLUMN IF EXISTS "workflowName",
  DROP COLUMN IF EXISTS "taskIds";
COMMIT;
