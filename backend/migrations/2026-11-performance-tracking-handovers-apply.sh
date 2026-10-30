#!/usr/bin/env bash
# Performance Tracking C4: task handovers + 1 setting (field minimum 10).
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new table and column. Safe to run
# again: it skips the migration if task_handovers already exists and only
# reports. Rollback: 2026-11-performance-tracking-handovers.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='task_handovers'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-handovers.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as task_handovers_columns from information_schema.columns where table_schema='public' and table_name='task_handovers'"
Q -c "select \"tenantId\", \"handoverFieldMin\" from performance_tracking_settings"
echo "PERFORMANCE TRACKING C4 MIGRATION DONE"
