#!/usr/bin/env bash
# Own performance figures for team members: one settings column (default:
# nobody). Takes a fresh backup first (../../db-backup.sh) and stops if it
# fails - this is the only backup, don't run db-backup.sh before it. Run it
# BEFORE the deploy - the new code reads the new column. Safe to run again:
# it skips the migration if the column already exists and only reports.
# Rollback: 2026-11-own-metrics-visibility.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_name='performance_tracking_settings' and column_name='ownMetricsRoles'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-own-metrics-visibility.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as own_metrics_column from information_schema.columns where table_name='performance_tracking_settings' and column_name='ownMetricsRoles'"
Q -c "select \"tenantId\", \"ownMetricsRoles\" as roles_that_see_own_figures from performance_tracking_settings"
echo "OWN METRICS VISIBILITY MIGRATION DONE"
