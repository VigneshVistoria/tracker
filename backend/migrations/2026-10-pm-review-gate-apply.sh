#!/usr/bin/env bash
# PM review gate: new columns on projects, project_tasks, task_qa_reviews,
# team_settings + % Complete rows for the two new statuses. Take a fresh
# backup first (../../db-backup.sh). Rollback: 2026-10-pm-review-gate.down.sql.
# Run BEFORE deploying the code that uses them.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }
CHECK="select table_name||'.'||column_name from information_schema.columns where table_schema='public' and (
  (table_name='projects' and column_name='pmReviewEnabled') or
  (table_name='project_tasks' and column_name='pmWaitWorkingDays') or
  (table_name='task_qa_reviews' and column_name in ('reminderSentAt','adminReminderSentAt')) or
  (table_name='team_settings' and column_name in ('pmReminderWorkingDays','pmReminderToAdmin'))) order by 1"

echo "=== Pre-check: columns not there yet"
HAS=$(Q -At -c "$CHECK" | wc -l)
[ "$HAS" = "0" ] || { echo "ABORT: $HAS of 6 PM review columns already exist"; exit 1; }
Q -At -c "select 'team_settings rows: '||count(*) from team_settings"

echo "=== Migration"
Q -q -f migrations/2026-10-pm-review-gate.sql

echo "=== Result (expect 6 columns, 2 status rows per tenant, every project OFF)"
Q -c "$CHECK"
Q -c "select \"tenantId\", status, percent from task_status_percent_config where status in ('Pending PM Review','PM Feedback') order by 1,2"
Q -c "select id, name, \"pmReviewEnabled\" from projects order by id"
echo "PM REVIEW GATE MIGRATION DONE"
