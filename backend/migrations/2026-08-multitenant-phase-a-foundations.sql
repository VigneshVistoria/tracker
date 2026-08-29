-- Multi-tenant conversion Phase A: schema foundation only.
--
-- Creates the tenants table, backfills every existing table with a
-- single tenant (the current company's data), then locks tenantId
-- NOT NULL with a FK + index. Purely additive - no query logic changes
-- anywhere yet (that's Phase C). Zero user-visible behavior change.
--
-- Rename the seeded tenant's name/subdomain later with a plain UPDATE
-- if 'Vistoria Systems' / 'vistoria' isn't the final choice - nothing
-- else in this migration depends on those literal values beyond using
-- them to look up the row's id below.

CREATE TABLE "tenants" (
  "id" SERIAL NOT NULL,
  "name" character varying NOT NULL,
  "subdomain" character varying NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_tenants_subdomain" UNIQUE ("subdomain"),
  CONSTRAINT "PK_tenants_id" PRIMARY KEY ("id")
);

INSERT INTO "tenants" ("name", "subdomain") VALUES ('Vistoria Systems', 'vistoria');

DO $$
DECLARE
  tbl text;
  tenant1_id integer;
BEGIN
  SELECT id INTO tenant1_id FROM "tenants" WHERE "subdomain" = 'vistoria';

  FOREACH tbl IN ARRAY ARRAY[
    'users', 'issues', 'projects', 'daily_updates', 'teams_subscriptions',
    'regression_test_runs', 'sprints', 'weekly_reports', 'dependencies',
    'evidence', 'audit_logs', 'modules', 'test_cases', 'test_executions',
    'sla_configs', 'performance_scoring_config', 'overdue_penalty_tiers'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "tenantId" integer', tbl);
    EXECUTE format('UPDATE %I SET "tenantId" = %L', tbl, tenant1_id);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "tenantId" SET NOT NULL', tbl);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "tenants"(id)', tbl, tbl || '_tenantId_fkey');
    EXECUTE format('CREATE INDEX %I ON %I ("tenantId")', 'idx_' || tbl || '_tenantid', tbl);
  END LOOP;
END $$;
