#!/usr/bin/env bash
# Daily Scrum Stage 3: one new, empty table (scrum_external_waits) for the
# "Waiting on the city office" box. Take a fresh backup first
# (../../db-backup.sh). Rollback: 2026-10-daily-scrum-external-waits.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Pre-check: table not there yet"
HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='scrum_external_waits'")
[ "$HAS" = "0" ] || { echo "ABORT: scrum_external_waits already exists"; exit 1; }

echo "=== Migration"
Q -q -f migrations/2026-10-daily-scrum-external-waits.sql

echo "=== Result"
Q -c "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='scrum_external_waits' order by ordinal_position"
Q -c "select count(*) as rows from scrum_external_waits"
echo "DAILY SCRUM EXTERNAL WAITS MIGRATION DONE"
