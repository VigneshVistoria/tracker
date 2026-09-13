-- Additive-only foundation for a future admin-manageable role/permission
-- system (see PROJECT.md §14 for the full audit and phased plan). This
-- migration only creates two new tables and seeds reference data into
-- them - it does not alter any existing table, and nothing in the
-- running app reads these tables yet. Every existing role check in
-- every controller/guard/service is completely untouched by this
-- change; today's authorization behavior is unaffected.

-- One row per role. tenantId is NULL for the six built-in system roles
-- (shared globally, one row each, never duplicated per tenant) and will
-- be set for a tenant's own custom roles once an admin UI to create
-- them exists. isProtected = true marks a role a future admin UI must
-- never allow deleting, renaming, or reassigning the key of.
CREATE TABLE "roles" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer,
  "key" character varying NOT NULL,
  "name" character varying NOT NULL,
  "isProtected" boolean NOT NULL DEFAULT false,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "roles"
  ADD CONSTRAINT "FK_roles_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

-- Postgres treats NULL as distinct in a unique index, so this only
-- actually enforces one-row-per-key-per-tenant for tenant-scoped
-- (non-NULL tenantId) custom roles; the six global system rows are kept
-- unique by the seed's own NOT EXISTS guard below instead.
CREATE UNIQUE INDEX "IDX_roles_tenant_key" ON "roles" ("tenantId", "key");

-- One row per (role, action) grant. scope is only meaningful for
-- actions where "can do this at all" isn't the same question as "on
-- which rows" (e.g. kpi.view_report is always scope='all' since it's
-- inherently cross-assignee; an action with no row-scoping concept
-- leaves scope NULL).
CREATE TABLE "role_permissions" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "roleId" integer NOT NULL,
  "actionKey" character varying NOT NULL,
  "scope" character varying,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "IDX_role_permissions_role_action" ON "role_permissions" ("roleId", "actionKey");

-- Seed the six existing system roles, shared globally (tenantId NULL).
INSERT INTO "roles" ("tenantId", "key", "name", "isProtected")
SELECT NULL, v.key, v.name, true
FROM (VALUES
  ('admin', 'Admin'),
  ('developer', 'Developer'),
  ('qa', 'QA'),
  ('executive', 'Executive'),
  ('program_manager', 'Program Manager'),
  ('client', 'Client')
) AS v(key, name)
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."tenantId" IS NULL AND r."key" = v.key);

-- Seed permissions for a first, narrowly-scoped slice only: KPI report/
-- generate and Time Sheet log/report. Chosen because both are small,
-- fully documented in PROJECT.md §14, and were re-read directly from
-- kpi.controller.ts and time-sheets.controller.ts in the same change
-- that wrote this seed, to guarantee it matches current behavior
-- exactly. Do NOT extend this seed to other modules without the same
-- read-the-actual-source verification step - see PROJECT.md §14
-- "Migration sequencing", step 2.
INSERT INTO "role_permissions" ("roleId", "actionKey", "scope")
SELECT r."id", v."actionKey", v."scope"
FROM "roles" r
JOIN (VALUES
  ('admin', 'kpi.view_report', 'all'),
  ('program_manager', 'kpi.view_report', 'all'),
  ('executive', 'kpi.view_report', 'all'),
  ('admin', 'kpi.generate', NULL),
  ('program_manager', 'kpi.generate', NULL),
  ('admin', 'time_sheet.log', NULL),
  ('developer', 'time_sheet.log', NULL),
  ('admin', 'time_sheet.view_report', 'all'),
  ('program_manager', 'time_sheet.view_report', 'all'),
  ('executive', 'time_sheet.view_report', 'all')
) AS v(key, "actionKey", "scope") ON v.key = r."key"
WHERE r."tenantId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp WHERE rp."roleId" = r."id" AND rp."actionKey" = v."actionKey"
  );
