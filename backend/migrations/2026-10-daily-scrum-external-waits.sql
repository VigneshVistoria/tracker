-- Daily Scrum Stage 3 (2026-10-16, confirmed with the user): the "Waiting
-- on the city office" box. Task dependencies are always owned by a user in
-- the app, so there is nothing that marks a wait as external - this is a
-- separate list a PM or Admin keeps by hand from the Daily Scrum Team tab.
-- Each row is one thing the team is waiting on from outside (the city
-- office by default), optionally tied to a ticket and to the team member
-- following it up. Rows are resolved, never deleted; every add/change is
-- in audit_logs. A new table only - no existing table changes - so the
-- running app is unaffected before and after the deploy.
BEGIN;
CREATE TABLE "scrum_external_waits" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" character varying(200) NOT NULL,
  "party" character varying(120) NOT NULL DEFAULT 'City office',
  "taskId" integer REFERENCES "project_tasks"("id") ON DELETE SET NULL,
  "followUpUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "requestedOn" date NOT NULL,
  "expectedBy" date,
  "note" text,
  "status" character varying(20) NOT NULL DEFAULT 'open',
  "resolvedAt" TIMESTAMP,
  "resolvedByUserId" integer,
  "createdByUserId" integer NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedByUserId" integer,
  CONSTRAINT "scrum_external_waits_status_check" CHECK ("status" IN ('open', 'resolved'))
);
CREATE INDEX "scrum_external_waits_tenant_status" ON "scrum_external_waits" ("tenantId", "status");
COMMIT;
