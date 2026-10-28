-- Performance Tracking, Wave 1 Stage S1 - foundation (2026-10-28, approved
-- by the user). See backend/src/performance-tracking/. Additive only:
-- nothing existing changes behaviour, and every project is OFF.
--   projects."performanceTrackingEnabled" - the per-project switch (OFF).
--   projects."performanceTrackingSince"   - when the project was FIRST
--     switched on (never reset): the go-live date for its rules and the
--     start of its 4-week Baseline.
--   performance_tracking_settings - editable thresholds, one row per tenant
--     (none = the defaults).
--   task_status_events - every task status change: from, to, when, who.
--
-- How task_status_events is filled:
--   * A trigger on project_tasks writes a row for every insert and every
--     status change, whichever code path made it (save, update, bulk), so
--     no change can be missed.
--   * Who did it comes from the audit entry of the action that changed the
--     status (allow-list in tracker_status_event_action()). Whichever is
--     written second links the pair: the project_tasks trigger looks back
--     for a just-written audit entry, and a trigger on audit_logs looks back
--     for a just-written event (within 30 seconds, same task, not already
--     linked). A change with no such audit entry keeps actorUserId null and
--     counts as a system change.
--   * History before this migration is rebuilt from audit_logs at the end
--     of this file ('reconstructed' rows).
-- Run once (the apply script skips it if the table already exists).
-- Rollback: 2026-10-performance-tracking-foundation.down.sql.
BEGIN;

ALTER TABLE "projects" ADD COLUMN "performanceTrackingEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "performanceTrackingSince" TIMESTAMP NULL;

CREATE TABLE "performance_tracking_settings" (
  "tenantId" integer NOT NULL,
  "baselineDays" integer NOT NULL DEFAULT 28,
  "notReadyDeclaredDependencyExempt" boolean NOT NULL DEFAULT true,
  "earlyWarningWorkingDays" integer NOT NULL DEFAULT 2,
  "dateMovesFlagCount" integer NOT NULL DEFAULT 2,
  "statusFreshWorkingDays" integer NOT NULL DEFAULT 2,
  "chasesPerTasks" integer NOT NULL DEFAULT 10,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedByUserId" integer,
  CONSTRAINT "PK_performance_tracking_settings" PRIMARY KEY ("tenantId")
);

CREATE TABLE "task_status_events" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "fromStatus" character varying(40),
  "toStatus" character varying(40) NOT NULL,
  "occurredAt" TIMESTAMP NOT NULL,
  "actorUserId" integer,
  "actorRole" character varying,
  "action" character varying(60),
  "auditLogId" integer,
  "source" character varying(20) NOT NULL,
  "recordedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_task_status_events" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_task_status_events_source" CHECK ("source" IN ('live', 'reconstructed'))
);
CREATE INDEX "IDX_task_status_events_tenant_task" ON "task_status_events" ("tenantId", "taskId");
CREATE INDEX "IDX_task_status_events_tenant_occurred" ON "task_status_events" ("tenantId", "occurredAt");
CREATE UNIQUE INDEX "UQ_task_status_events_auditLogId" ON "task_status_events" ("auditLogId") WHERE "auditLogId" IS NOT NULL;
-- The look-ups below search a task's recent audit entries.
CREATE INDEX IF NOT EXISTS "IDX_audit_logs_entity" ON "audit_logs" ("entityType", "entityId");

-- The audit actions that change a task's status (keep in step with
-- STATUS_EVENT_AUDIT_ACTIONS in src/performance-tracking/performance-
-- tracking.ts - a test checks they match).
CREATE FUNCTION tracker_status_event_action(a text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT a IN (
    'task_created', 'task_defect_created', 'task_status_changed',
    'task_qa_submitted', 'task_pm_review_submitted', 'task_peer_review_submitted',
    'task_qa_approved', 'task_qa_rejected', 'task_qa_escalated', 'task_qa_not_ready', 'task_qa_decision_reverted',
    'task_peer_review_approved', 'task_peer_review_rejected',
    'task_pm_sent_to_qa', 'task_pm_sent_back', 'task_pm_sent_back_from_qa',
    'task_returned_to_qa', 'task_return_to_qa_sent_back',
    'task_escalation_reassigned', 'task_escalation_closed_junk',
    'task_marked_junk', 'task_restored_from_junk',
    'task_held', 'task_released_from_hold', 'task_closed', 'task_reopened',
    'defect_triage_disputed', 'defect_dispute_decided'
  )
$$;

-- project_tasks: one event per insert / status change. On insert the
-- creator is known from the row itself. Both triggers are fail-safe: any
-- error is logged as a WARNING and that event is skipped - recording
-- history must never fail the user's action or its audit entry.
CREATE FUNCTION tracker_task_status_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ev_id integer;
  a record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;
  BEGIN
  INSERT INTO "task_status_events" ("tenantId", "taskId", "fromStatus", "toStatus", "occurredAt", "actorUserId", "source")
  VALUES (NEW."tenantId", NEW."id", CASE WHEN TG_OP = 'UPDATE' THEN OLD."status" END, NEW."status", now(),
          CASE WHEN TG_OP = 'INSERT' THEN NEW."createdByUserId" END, 'live')
  RETURNING "id" INTO ev_id;
  -- Audit entry written first (same transaction, or just before)?
  SELECT l."id", l."userId", l."userRole", l."action" INTO a
    FROM "audit_logs" l
   WHERE l."entityType" = 'ProjectTask' AND l."entityId" = NEW."id"
     AND tracker_status_event_action(l."action")
     AND (l."action" IN ('task_created', 'task_defect_created')) = (TG_OP = 'INSERT')
     AND l."createdAt" >= now() - interval '30 seconds'
     AND NOT EXISTS (SELECT 1 FROM "task_status_events" e WHERE e."auditLogId" = l."id")
   ORDER BY l."id" DESC LIMIT 1;
  IF FOUND THEN
    UPDATE "task_status_events"
       SET "auditLogId" = a."id", "actorUserId" = a."userId", "actorRole" = a."userRole", "action" = a."action"
     WHERE "id" = ev_id;
  END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'task_status_events: skipped event for task % (%)', NEW."id", SQLERRM;
  END;
  RETURN NEW;
END
$$;

CREATE TRIGGER "TRG_project_tasks_status_event"
  AFTER INSERT OR UPDATE OF "status" ON "project_tasks"
  FOR EACH ROW EXECUTE FUNCTION tracker_task_status_event();

-- audit_logs: a status action written after the change claims the task's
-- latest unlinked event of the matching kind - a creation entry only the
-- creation event, any other entry only a real status change - so an entry
-- written just BEFORE its change never claims an older event.
CREATE FUNCTION tracker_link_status_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  is_creation boolean;
BEGIN
  IF NEW."entityType" IS DISTINCT FROM 'ProjectTask' OR NEW."entityId" IS NULL OR NOT tracker_status_event_action(NEW."action") THEN
    RETURN NEW;
  END IF;
  is_creation := NEW."action" IN ('task_created', 'task_defect_created');
  BEGIN
  UPDATE "task_status_events"
     SET "auditLogId" = NEW."id", "actorUserId" = NEW."userId", "actorRole" = NEW."userRole", "action" = NEW."action"
   WHERE "id" = (
     SELECT e."id" FROM "task_status_events" e
      WHERE e."taskId" = NEW."entityId" AND e."auditLogId" IS NULL AND e."source" = 'live'
        AND (e."fromStatus" IS NULL) = is_creation
        AND e."occurredAt" >= NEW."createdAt" - interval '30 seconds'
      ORDER BY e."id" DESC LIMIT 1
   );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'task_status_events: could not link audit entry % (%)', NEW."id", SQLERRM;
  END;
  RETURN NEW;
END
$$;

CREATE TRIGGER "TRG_audit_logs_link_status_event"
  AFTER INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION tracker_link_status_event();

-- History: one 'reconstructed' event per past status action in audit_logs,
-- plus a creation event for a task created without its own audit entry
-- (bulk import). fromStatus = the task's previous event's toStatus.
-- Actions whose target status can't be told from the entry are skipped;
-- the apply script reports any task whose rebuilt history doesn't end on
-- its current status.
WITH src AS (
  SELECT l."id", t."tenantId", l."entityId" AS "taskId", l."action", l."userId", l."userRole", l."createdAt",
         CASE WHEN l."details" ~ '^\s*\{' THEN l."details"::jsonb ELSE '{}'::jsonb END AS d
    FROM "audit_logs" l
    JOIN "project_tasks" t ON t."id" = l."entityId"
   WHERE l."entityType" = 'ProjectTask' AND tracker_status_event_action(l."action")
),
mapped AS (
  SELECT src.*,
    CASE
      WHEN d ? 'statusTo' THEN d->>'statusTo'
      WHEN "action" = 'task_status_changed' THEN d->>'to'
      WHEN "action" IN ('task_created', 'task_defect_created', 'task_escalation_reassigned') THEN 'Development'
      WHEN "action" IN ('task_qa_approved', 'task_peer_review_approved') THEN 'Pass'
      WHEN "action" IN ('task_qa_rejected', 'task_peer_review_rejected') THEN 'Failed'
      WHEN "action" = 'task_qa_escalated' THEN 'Escalated'
      WHEN "action" = 'task_qa_not_ready' THEN 'Not Ready for Testing'
      WHEN "action" = 'task_pm_review_submitted' THEN 'Pending PM Review'
      WHEN "action" = 'task_pm_sent_back' THEN 'PM Feedback'
      WHEN "action" = 'task_held' THEN 'Hold'
      WHEN "action" = 'task_closed' THEN 'Closed'
      WHEN "action" IN ('task_marked_junk', 'task_escalation_closed_junk') THEN COALESCE(d->>'newStatus', 'Junk')
      WHEN "action" = 'task_restored_from_junk' THEN d->>'newStatus'
      WHEN "action" IN ('task_released_from_hold', 'task_reopened') THEN d->>'restoredStatus'
      WHEN "action" = 'task_peer_review_submitted' THEN
        CASE WHEN COALESCE((d->>'roundNumber')::int, 1) > 1 THEN 'Re-Peer-Review' ELSE 'Peer Review' END
      WHEN "action" = 'task_qa_submitted' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM "task_qa_reviews" r
           WHERE r."taskId" = src."taskId" AND r."reviewType" <> 'pm'
             AND r."status" NOT IN ('reverted', 'withdrawn', 'not_ready')
             AND r."roundNumber" < COALESCE((d->>'roundNumber')::int, 1)
        ) THEN 'Re-Feedback' ELSE 'Feedback' END
    END AS "toStatus"
  FROM src
),
created_without_audit AS (
  SELECT NULL::integer AS "id", t."tenantId", t."id" AS "taskId", 'task_created'::text AS "action",
         t."createdByUserId" AS "userId", NULL::varchar AS "userRole", t."createdAt", 'Development'::text AS "toStatus"
    FROM "project_tasks" t
   WHERE NOT EXISTS (
     SELECT 1 FROM "audit_logs" l
      WHERE l."entityType" = 'ProjectTask' AND l."entityId" = t."id" AND l."action" IN ('task_created', 'task_defect_created')
   )
),
all_events AS (
  SELECT "id", "tenantId", "taskId", "action", "userId", "userRole", "createdAt", "toStatus" FROM mapped WHERE "toStatus" IS NOT NULL
  UNION ALL
  SELECT * FROM created_without_audit
)
INSERT INTO "task_status_events"
  ("tenantId", "taskId", "fromStatus", "toStatus", "occurredAt", "actorUserId", "actorRole", "action", "auditLogId", "source")
SELECT "tenantId", "taskId",
       LAG("toStatus") OVER (PARTITION BY "taskId" ORDER BY "createdAt", "id" NULLS FIRST),
       "toStatus", "createdAt", "userId", "userRole", "action", "id", 'reconstructed'
  FROM all_events
 ORDER BY "createdAt", "id" NULLS FIRST;

COMMIT;
