#!/usr/bin/env bash
# Performance Tracking O4: escalation reason codes + avoidable flag.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new columns. Safe to run again: it
# skips the migration if task_qa_reviews.escalationReasonCode already
# exists and only reports.
# Rollback: 2026-11-performance-tracking-escalation-reasons.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='task_qa_reviews' and column_name='escalationReasonCode'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-escalation-reasons.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select count(*) as new_review_columns from information_schema.columns where table_name='task_qa_reviews' and column_name in ('escalationReasonCode','escalationAvoidable')"
Q -c "select \"tenantId\", \"escalationsPerRounds\", jsonb_array_length(\"escalationReasons\") as reasons, (select count(*) from jsonb_array_elements(\"escalationReasons\") r where (r->>'avoidable')::boolean) as avoidable from performance_tracking_settings"
Q -c "select count(*) filter (where status = 'escalated') as escalated_rounds, count(\"escalationReasonCode\") as with_reason from task_qa_reviews"
echo "PERFORMANCE TRACKING O4 MIGRATION DONE"
