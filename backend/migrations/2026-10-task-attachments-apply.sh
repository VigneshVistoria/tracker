#!/usr/bin/env bash
# Defect screenshots: one new table (task_attachments). Take a fresh
# backup first (../../db-backup.sh). Rollback:
# 2026-10-task-attachments.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Pre-check: table not there yet"
HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='task_attachments'")
[ "$HAS" = "0" ] || { echo "ABORT: task_attachments already exists"; exit 1; }

echo "=== Migration"
Q -q -f migrations/2026-10-task-attachments.sql

echo "=== Result"
Q -c "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='task_attachments' order by ordinal_position"
echo "TASK ATTACHMENTS MIGRATION DONE"
