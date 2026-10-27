#!/usr/bin/env bash
# Submission checklist (defect triage Stage 2): 3 columns + "Submission
# incomplete" on any saved Not ready list.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails.
# Rollback: 2026-10-submission-checklist.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend

echo "=== Backup"
../db-backup.sh

set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Migration"
Q -q -f migrations/2026-10-submission-checklist.sql

echo "=== Result"
Q -c "select table_name, column_name, data_type from information_schema.columns where table_schema='public' and ((table_name='projects' and column_name='submissionChecklistEnabled') or (table_name='task_qa_reviews' and column_name='submissionChecklist') or (table_name='team_settings' and column_name='submissionChecklistSettings')) order by 1"
Q -c "select \"tenantId\", \"qaNotReadyReasons\" from team_settings"
echo "SUBMISSION CHECKLIST MIGRATION DONE"
