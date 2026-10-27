#!/usr/bin/env bash
# QA "Not ready for testing": 2 columns + 1 status row per tenant.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails.
# Rollback: 2026-10-qa-not-ready.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend

echo "=== Backup"
../db-backup.sh

set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Migration"
Q -q -f migrations/2026-10-qa-not-ready.sql

echo "=== Result"
Q -c "select table_name, column_name, data_type, column_default from information_schema.columns where table_schema='public' and ((table_name='task_qa_reviews' and column_name='notReadyReason') or (table_name='team_settings' and column_name='qaNotReadyReasons')) order by 1"
Q -c "select count(*) as tenants, (select count(*) from task_status_percent_config where status='Not Ready for Testing') as status_rows from tenants"
echo "QA NOT READY MIGRATION DONE"
