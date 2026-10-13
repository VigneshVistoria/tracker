-- Daily Scrum Stage 1 (2026-10-12, confirmed with the user): one row of
-- team settings per tenant. timeZone decides "today" and the "since last
-- working day" window (00:00 in this zone on the last Mon-Fri before
-- today). workdayStart/workdayEnd are shown for information only and
-- never cut that window. Admin and Program Manager edit it from
-- Admin -> Daily Scrum Settings. A new table only - no existing table
-- changes - so the running app is unaffected before and after the deploy.
BEGIN;
CREATE TABLE "team_settings" (
  "tenantId" integer PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "timeZone" character varying NOT NULL DEFAULT 'Africa/Addis_Ababa',
  "workdayStart" character varying(5) NOT NULL DEFAULT '07:30',
  "workdayEnd" character varying(5) NOT NULL DEFAULT '15:30',
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedByUserId" integer
);

-- One row for every existing tenant, all on the defaults above.
INSERT INTO "team_settings" ("tenantId") SELECT "id" FROM "tenants" ON CONFLICT DO NOTHING;
COMMIT;
