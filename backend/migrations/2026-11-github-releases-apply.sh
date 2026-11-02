#!/usr/bin/env bash
# Performance Tracking P1/P2 from GitHub: settings (switch OFF), repository
# mappings, delivery log, staging deployments, GitHub columns on releases
# and users. Takes a fresh backup first (../../db-backup.sh) and stops if
# it fails - this is the only backup, don't run db-backup.sh before it.
# Run it BEFORE the deploy - the new code reads the new tables and
# columns. Safe to run again: it skips the migration if github_settings
# already exists and only reports.
# Rollback: 2026-11-github-releases.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='github_settings'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-github-releases.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as github_tables from information_schema.tables where table_schema='public' and table_name in ('github_settings','github_repo_mappings','github_webhook_deliveries','github_staging_deployments')"
Q -c "select count(*) as release_columns from information_schema.columns where table_name='releases' and column_name in ('source','githubRepo','githubSha','githubDeliveryId','githubReleasedByLogin','githubStagingDeployedOn','githubFilled','githubNotes')"
Q -c "select count(*) as user_column from information_schema.columns where table_name='users' and column_name='githubLogin'"
Q -c "select source, count(*) as releases from releases group by source"
Q -c "select (select count(*) from github_settings) as settings_rows, (select count(*) from github_repo_mappings) as mappings"
echo "GITHUB RELEASES MIGRATION DONE"
