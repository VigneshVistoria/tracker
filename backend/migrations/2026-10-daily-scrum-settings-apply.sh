#!/usr/bin/env bash
# Daily Scrum settings: one new table (team_settings), seeded with one row
# per tenant. Take a fresh backup first (../../db-backup.sh). Rollback:
# 2026-10-daily-scrum-settings.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Pre-check: table not there yet"
HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='team_settings'")
[ "$HAS" = "0" ] || { echo "ABORT: team_settings already exists"; exit 1; }
Q -c "select count(*) as tenants from tenants"

echo "=== Migration"
Q -q -f migrations/2026-10-daily-scrum-settings.sql

echo "=== Result"
Q -c "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='team_settings' order by ordinal_position"
Q -c "select \"tenantId\", \"timeZone\", \"workdayStart\", \"workdayEnd\" from team_settings order by 1"
echo "DAILY SCRUM SETTINGS MIGRATION DONE"
