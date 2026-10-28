-- Performance metrics history (2026-10-27): makes a task_commitment_events
-- row, marked 'reconstructed', from every past assignment / Due date audit
-- entry - the same rules as commitmentEventFromAudit() in
-- src/performance-metrics/commitment-events.ts (test/performance-
-- metrics.e2e-spec.ts checks both give the same rows). 2026-10-28: also
-- 'due_committed' (Performance Tracking proposed dates). Only reads
-- audit_logs/project_tasks. Safe to run again at any time: an entry that
-- already has its event (live or reconstructed) is skipped, so running it
-- once more after the deploy fills any gap between the first run and the
-- deploy.
BEGIN;
WITH src AS (
  SELECT a."id", COALESCE(a."tenantId", t."tenantId") AS "tenantId", a."action", a."entityId" AS "taskId",
         a."userId", a."userRole", a."createdAt", a."details"::jsonb AS d
  FROM "audit_logs" a
  JOIN "project_tasks" t ON t."id" = a."entityId"
  WHERE a."entityType" = 'ProjectTask'
    AND a."action" IN ('task_created', 'task_defect_created', 'task_assigned', 'task_reassigned', 'task_escalation_reassigned', 'task_updated', 'task_due_date_committed')
    AND a."details" IS NOT NULL
),
parsed AS (
  SELECT src.*,
    CASE WHEN jsonb_typeof(d->'assigneeUserId') IN ('number', 'string') AND (d->>'assigneeUserId') ~ '^-?[0-9]+$'
         THEN (d->>'assigneeUserId')::int END AS assignee,
    CASE WHEN jsonb_typeof(d->'previousAssigneeUserId') IN ('number', 'string') AND (d->>'previousAssigneeUserId') ~ '^-?[0-9]+$'
         THEN (d->>'previousAssigneeUserId')::int END AS prev_assignee,
    CASE WHEN jsonb_typeof(d->'previous'->'assigneeUserId') IN ('number', 'string') AND (d->'previous'->>'assigneeUserId') ~ '^-?[0-9]+$'
         THEN (d->'previous'->>'assigneeUserId')::int END AS snapshot_assignee,
    (jsonb_typeof(d->'updated') = 'object' AND (d->'updated') ? 'dueDate') AS has_due,
    CASE WHEN jsonb_typeof(d->'previous'->'dueDate') = 'string' AND (d->'previous'->>'dueDate') <> ''
         THEN left(d->'previous'->>'dueDate', 10) END AS old_date,
    CASE WHEN jsonb_typeof(d->'updated'->'dueDate') = 'string' AND (d->'updated'->>'dueDate') <> ''
         THEN left(d->'updated'->>'dueDate', 10) END AS new_date,
    (d->>'dueDateCommitment') = 'true' AS own_commit,
    CASE WHEN jsonb_typeof(d->'dueDate') = 'string' AND (d->>'dueDate') <> '' THEN left(d->>'dueDate', 10) END AS confirmed_date,
    (d->>'confirmed') = 'true' AS confirmed
  FROM src
),
events AS (
  SELECT parsed.*,
    CASE
      WHEN "action" IN ('task_created', 'task_defect_created', 'task_assigned') AND assignee IS NOT NULL THEN 'assigned'
      WHEN "action" IN ('task_reassigned', 'task_escalation_reassigned') AND assignee IS DISTINCT FROM prev_assignee
        THEN CASE WHEN assignee IS NULL THEN 'unassigned' ELSE 'assigned' END
      WHEN "action" = 'task_updated' AND has_due AND old_date IS DISTINCT FROM new_date
        THEN CASE WHEN own_commit AND old_date IS NOT NULL AND new_date IS NOT NULL THEN 'due_committed'
                  WHEN old_date IS NULL THEN 'due_set' WHEN new_date IS NULL THEN 'due_cleared' ELSE 'due_changed' END
      WHEN "action" = 'task_due_date_committed' AND confirmed AND confirmed_date IS NOT NULL THEN 'due_committed'
    END AS kind
  FROM parsed
)
INSERT INTO "task_commitment_events"
  ("tenantId", "taskId", "kind", "assigneeUserId", "previousAssigneeUserId", "actorUserId", "actorRole", "occurredAt",
   "oldDueDate", "newDueDate", "direction", "source", "auditLogId")
SELECT "tenantId", "taskId", kind,
  CASE WHEN "action" = 'task_updated' THEN snapshot_assignee
       WHEN "action" = 'task_due_date_committed' THEN COALESCE(assignee, "userId") ELSE assignee END,
  CASE WHEN "action" IN ('task_reassigned', 'task_escalation_reassigned') THEN prev_assignee END,
  "userId", "userRole", "createdAt",
  CASE WHEN "action" = 'task_updated' THEN old_date::date WHEN "action" = 'task_due_date_committed' THEN confirmed_date::date END,
  CASE WHEN "action" = 'task_updated' THEN new_date::date WHEN "action" = 'task_due_date_committed' THEN confirmed_date::date END,
  CASE WHEN kind = 'due_changed' THEN CASE WHEN new_date > old_date THEN 'later' ELSE 'earlier' END END,
  'reconstructed', "id"
FROM events
WHERE kind IS NOT NULL AND "tenantId" IS NOT NULL
ORDER BY "id"
ON CONFLICT ("auditLogId") DO NOTHING;
COMMIT;
