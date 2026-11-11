#!/usr/bin/env bash
# GitHub PR helpers: 3 settings columns on github_settings (switch OFF).
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new columns. Safe to run again: it
# skips the migration if the columns already exist and only reports.
# Rollback: 2026-11-github-pr-helpers.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_name='github_settings' and column_name='prHelpersEnabled'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-github-pr-helpers.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as pr_helper_columns from information_schema.columns where table_name='github_settings' and column_name in ('prHelpersEnabled','prHelperProjectIds','branchPrefix')"
Q -c "select \"tenantId\", enabled as releases_on, \"prHelpersEnabled\" as pr_helpers_on, \"prHelperProjectIds\" as projects, \"branchPrefix\" from github_settings"
echo "GITHUB PR HELPERS MIGRATION DONE"
