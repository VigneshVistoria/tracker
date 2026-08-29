-- Phase A follow-up fix: the original migration made tenantId NOT NULL
-- on every table but gave it no DEFAULT, and no application code sets it
-- explicitly yet (that's Phase C). Any row creation between the Phase A
-- deploy and Phase C landing would fail with a NOT NULL violation.
--
-- Defaulting to tenant 1 is correct today (it's the only tenant that
-- exists), and this default becomes a no-op once Phase C starts setting
-- tenantId explicitly from the authenticated request's own tenant.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users', 'issues', 'projects', 'daily_updates', 'teams_subscriptions',
    'regression_test_runs', 'sprints', 'weekly_reports', 'dependencies',
    'evidence', 'audit_logs', 'modules', 'test_cases', 'test_executions',
    'sla_configs', 'performance_scoring_config', 'overdue_penalty_tiers'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "tenantId" SET DEFAULT 1', tbl);
  END LOOP;
END $$;
