#!/usr/bin/env bash
# GitHub multi-stage release path: switch (OFF), stage list + P1 stage per
# repository, stage deploys, task stage progress. Takes a fresh backup first
# (../../db-backup.sh) and stops if it fails - this is the only backup,
# don't run db-backup.sh before it. Run it BEFORE the deploy - the new code
# reads the new tables and columns. Safe to run again: it skips the
# migration if github_stage_deployments already exists and only reports.
# Rollback: 2026-11-github-release-stages.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='github_stage_deployments'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-github-release-stages.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select (select count(*) from information_schema.columns where table_name='github_settings' and column_name='releaseStagesEnabled') as switch_col, (select count(*) from information_schema.columns where table_name='github_repo_mappings' and column_name in ('stages','p1StageKey')) as mapping_cols, (select count(*) from information_schema.columns where table_name='github_webhook_deliveries' and column_name='stageName') as delivery_col"
Q -c "select (select count(*) from github_stage_deployments) as stage_deploys, (select count(*) from task_stage_progress) as task_progress, (select count(*) from github_repo_mappings where jsonb_array_length(stages) > 0) as repos_with_stages"
Q -c "select \"tenantId\", enabled as releases_on, \"releaseStagesEnabled\" as stages_on from github_settings"
echo "GITHUB RELEASE STAGES MIGRATION DONE"
