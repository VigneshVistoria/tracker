#!/usr/bin/env bash
# Performance Tracking Q5: technical reviews, evidence log, reviewer
# setting (#3 only) and rubric.
# Takes a fresh backup first (../../db-backup.sh) and stops if it fails -
# this is the only backup, don't run db-backup.sh before it. Run it BEFORE
# the deploy - the new code reads the new tables and columns. Safe to run
# again: it skips the migration if tech_reviews already exists and only
# reports. Rollback: 2026-11-performance-tracking-tech-reviews.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='tech_reviews'")
if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-performance-tracking-tech-reviews.sql
else
  echo "=== Already applied - report only"
fi

echo "=== Result"
Q -c "select table_name, count(*) as columns from information_schema.columns where table_schema='public' and table_name in ('tech_reviews','tech_review_evidence') group by 1 order by 1"
Q -c "select \"tenantId\", \"techReviewerUserIds\", \"techReviewsPerMonth\", \"techReviewCriteria\" from performance_tracking_settings"
Q -c "select count(*) as reviewer_audit_entries from audit_logs where \"userEmail\" = 'migration 2026-11-performance-tracking-tech-reviews'"
echo "PERFORMANCE TRACKING Q5 MIGRATION DONE"
