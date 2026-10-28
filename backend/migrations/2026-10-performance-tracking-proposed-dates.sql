-- Performance Tracking - proposed Due dates (2026-10-28, decisions from
-- the user). With a project's tracking ON, a date a PM or Admin sets is
-- PROPOSED until the assignee confirms it or sets their own (once); only
-- then is it their commitment and locked. That moment is now an event in
-- the date-history log, so every metric reads one source:
--   task_commitment_events.kind 'due_committed' - the assignee committed:
--     a Confirm (old = new = the date) or their own date (old -> new).
--     Written live by AuditLogService from task_due_date_committed /
--     dueDateCommitment entries (src/performance-metrics/commitment-
--     events.ts, same rules as the backfill script).
-- History: any earlier "own date" commitment recorded as due_changed
-- becomes due_committed, and earlier Confirms (audit only until now) get
-- their event. Additive otherwise; projects with tracking OFF are
-- unaffected. Run once (the apply script skips it if already applied).
-- Rollback: 2026-10-performance-tracking-proposed-dates.down.sql.
BEGIN;

ALTER TABLE "task_commitment_events" DROP CONSTRAINT "CHK_task_commitment_events_kind";
ALTER TABLE "task_commitment_events" ADD CONSTRAINT "CHK_task_commitment_events_kind"
  CHECK ("kind" IN ('assigned', 'unassigned', 'due_set', 'due_changed', 'due_cleared', 'due_committed'));

UPDATE "task_commitment_events" e
   SET "kind" = 'due_committed', "direction" = NULL
  FROM "audit_logs" a
 WHERE a."id" = e."auditLogId"
   AND e."kind" = 'due_changed'
   AND a."action" = 'task_updated'
   AND (a."details"::jsonb ->> 'dueDateCommitment') = 'true';

INSERT INTO "task_commitment_events"
  ("tenantId", "taskId", "kind", "assigneeUserId", "previousAssigneeUserId", "actorUserId", "actorRole", "occurredAt",
   "oldDueDate", "newDueDate", "direction", "source", "auditLogId")
SELECT COALESCE(a."tenantId", t."tenantId"), a."entityId", 'due_committed',
       COALESCE(CASE WHEN (a."details"::jsonb ->> 'assigneeUserId') ~ '^-?[0-9]+$' THEN (a."details"::jsonb ->> 'assigneeUserId')::int END, a."userId"),
       NULL, a."userId", a."userRole", a."createdAt",
       left(a."details"::jsonb ->> 'dueDate', 10)::date, left(a."details"::jsonb ->> 'dueDate', 10)::date, NULL,
       'reconstructed', a."id"
  FROM "audit_logs" a
  JOIN "project_tasks" t ON t."id" = a."entityId"
 WHERE a."entityType" = 'ProjectTask'
   AND a."action" = 'task_due_date_committed'
   AND (a."details"::jsonb ->> 'confirmed') = 'true'
   AND (a."details"::jsonb ->> 'dueDate') ~ '^\d{4}-\d{2}-\d{2}'
ON CONFLICT ("auditLogId") DO NOTHING;

COMMIT;
