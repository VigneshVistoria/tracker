#!/usr/bin/env bash
# "New My work screen" setting: 1 jsonb column on team_settings (OFF).
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new column. Safe to run again: it
# skips the migration if the column already exists and only reports.
# Rollback: 2026-11-my-work-screen.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_name='team_settings' and column_name='myWorkScreen'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-my-work-screen.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select column_name, data_type, column_default from information_schema.columns where table_name='team_settings' and column_name='myWorkScreen'"
Q -c "select \"tenantId\", \"myWorkScreen\" from team_settings"
echo "MY WORK SCREEN MIGRATION DONE"
