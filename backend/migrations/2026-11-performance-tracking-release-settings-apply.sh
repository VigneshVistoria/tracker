#!/usr/bin/env bash
# Performance Tracking P1/P2 settings: 90-day release window, minimum 3
# releases. Takes a fresh backup first (../../db-backup.sh) and stops if it
# fails - this is the only backup, don't run db-backup.sh before it. Run it
# BEFORE the deploy - the new code reads the new columns. Safe to run
# again: it skips the migration if the column already exists and only
# reports.
# Rollback: 2026-11-performance-tracking-release-settings.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='performance_tracking_settings' and column_name='releaseWindowDays'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-release-settings.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select \"tenantId\", \"releaseWindowDays\", \"releaseMinSample\" from performance_tracking_settings"
echo "PERFORMANCE TRACKING P1/P2 SETTINGS MIGRATION DONE"
