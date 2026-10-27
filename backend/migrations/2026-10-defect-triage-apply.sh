#!/usr/bin/env bash
# Defect triage Stage 1: 1 table, 8 columns, 1 status row per tenant.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails.
# Rollback: 2026-10-defect-triage.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend

echo "=== Backup"
../db-backup.sh

set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Migration"
Q -q -f migrations/2026-10-defect-triage.sql

echo "=== Result"
Q -c "select table_name, column_name, data_type from information_schema.columns where table_schema='public' and ((table_name='projects' and column_name='defectTriageEnabled') or (table_name='project_tasks' and column_name in ('severity','defectType','defectOrigin','foundInBuild','foundInEnvironment','triageStatus')) or (table_name='team_settings' and column_name='defectTriageSettings')) order by 1, 2"
Q -c "select count(*) as defect_triages_columns from information_schema.columns where table_schema='public' and table_name='defect_triages'"
Q -c "select count(*) as tenants, (select count(*) from task_status_percent_config where status='Disputed') as status_rows, (select count(*) from projects where \"defectTriageEnabled\") as projects_switched_on from tenants"
echo "DEFECT TRIAGE MIGRATION DONE"
