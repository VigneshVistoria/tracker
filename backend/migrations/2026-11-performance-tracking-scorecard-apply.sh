#!/usr/bin/env bash
# Performance Tracking B3: score overrides + who may override.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new table and column. Safe to run again: it
# skips the migration if the overrides table already exists and only
# reports. Rollback: 2026-11-performance-tracking-scorecard.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='performance_score_overrides'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-scorecard.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as override_columns from information_schema.columns where table_schema='public' and table_name='performance_score_overrides'"
Q -c "select count(*) as active_unique_index from pg_indexes where indexname = 'UQ_performance_score_overrides_active'"
Q -c "select count(*) as score_check from pg_constraint where conname = 'CHK_pso_score'"
Q -c "select column_name, column_default from information_schema.columns where table_name='performance_tracking_settings' and column_name='overrideRoles'"
Q -c "select count(*) as overrides from performance_score_overrides"
echo "PERFORMANCE TRACKING B3 MIGRATION DONE"
