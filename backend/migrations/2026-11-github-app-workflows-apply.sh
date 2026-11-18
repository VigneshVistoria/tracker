#!/usr/bin/env bash
# Two apps in one repository by workflow name: github_repo_mappings gets
# "appWorkflows" and the unique index becomes repository + app name.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new column. Safe to run again: it
# skips the migration if the column already exists and only reports.
# Rollback: 2026-11-github-app-workflows.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_name='github_repo_mappings' and column_name='appWorkflows'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-github-app-workflows.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as app_workflows_column from information_schema.columns where table_name='github_repo_mappings' and column_name='appWorkflows'"
Q -c "select indexname, indexdef from pg_indexes where tablename='github_repo_mappings' and indexname like 'UQ_%'"
Q -c "select count(*) as mappings from github_repo_mappings"
echo "GITHUB APP WORKFLOWS MIGRATION DONE"
