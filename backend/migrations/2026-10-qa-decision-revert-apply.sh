#!/usr/bin/env bash
# Revert QA decision: 4 nullable columns on task_qa_reviews. Take a fresh
# backup first (../../db-backup.sh). Rollback: 2026-10-qa-decision-revert.down.sql.
# Run BEFORE deploying the code that uses them.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }
COLS="'revertedByUserId','revertedAt','revertReason','revertedDecision'"

echo "=== Pre-check: columns not there yet"
HAS=$(Q -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='task_qa_reviews' and column_name in ($COLS)")
[ "$HAS" = "0" ] || { echo "ABORT: revert columns already exist ($HAS of 4)"; exit 1; }

echo "=== Migration"
Q -q -f migrations/2026-10-qa-decision-revert.sql

echo "=== Result (expect 4 rows)"
Q -c "select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='task_qa_reviews' and column_name in ($COLS) order by 1"
echo "QA DECISION REVERT MIGRATION DONE"
