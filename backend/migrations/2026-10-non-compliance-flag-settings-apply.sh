#!/usr/bin/env bash
# Non-Compliance flag thresholds: 5 columns on performance_metric_settings.
# Take a fresh backup first (../../db-backup.sh). Rollback:
# 2026-10-non-compliance-flag-settings.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }
COLS="'lateToQaFlagCount','rejectionRateFlagPercent','rejectionRateMinSubmissions','escalationFlagCount','vagueNotesFlagCount'"

echo "=== Pre-check: columns not there yet"
HAS=$(Q -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='performance_metric_settings' and column_name in ($COLS)")
[ "$HAS" = "0" ] || { echo "ABORT: flag columns already exist ($HAS of 5)"; exit 1; }

echo "=== Migration"
Q -q -f migrations/2026-10-non-compliance-flag-settings.sql

echo "=== Result"
Q -c "select column_name, data_type, column_default from information_schema.columns where table_schema='public' and table_name='performance_metric_settings' and column_name in ($COLS) order by 1"
echo "NON-COMPLIANCE FLAG SETTINGS MIGRATION DONE"
