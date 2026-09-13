-- QA Feedback escalation to PM: QA can escalate a pending QA Feedback
-- round instead of Approve/Reject (task_qa_reviews.status gets a new
-- 'escalated' value, plain varchar column, no schema change needed there).
-- The task itself moves to a new 'Escalated' status while it sits in the
-- PM's queue, then either 'Development' again (PM reassigns) or a new
-- terminal 'Junk' status (PM closes it as not a real issue) - neither of
-- those needs a project_tasks schema change either (status is already a
-- plain varchar column). Only new thing this migration adds is the
-- % Complete config seed for the two new status values, same pattern as
-- 2026-09-peer-review.sql.

INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Escalated', 50
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Escalated'
);

INSERT INTO "task_status_percent_config" ("tenantId", "status", "percent")
SELECT t."id", 'Junk', 0
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "task_status_percent_config" c WHERE c."tenantId" = t."id" AND c."status" = 'Junk'
);
