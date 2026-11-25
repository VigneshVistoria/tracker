#!/usr/bin/env bash
# Requirements traceability Stage 2: the 'ba' role value, client sign-off
# and at-risk columns, srs_ticket_criteria, srs_client_items (+ stories),
# then the Lien SRS's 5 open client items.
#
#   ./2026-11-requirements-s2-apply.sh --check   read-only: shows what is
#                                                already applied and that
#                                                no user holds 'ba'. Changes
#                                                nothing, takes no backup.
#   ./2026-11-requirements-s2-apply.sh           backup, migrate, seed, report
#
# Takes a fresh backup first (../db-backup.sh) and stops if it fails - this
# is the only backup, don't run db-backup.sh before it. Run it BEFORE the
# Stage 2 deploy. Safe to run again: skips the migration if
# srs_client_items exists and the seed if the SRS already has client items.
# Rollback: 2026-11-requirements-s2.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Before"
Q -c "select d.id, d.name, d.version, d.status, p.name as project from srs_documents d join projects p on p.id = d.\"projectId\" where d.\"projectId\" = 6"
Q -c "select role::text, count(*) from users group by 1 order by 1"
Q -At -c "select 'ba in users_role_enum: ' || exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'users_role_enum' and e.enumlabel = 'ba')"

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_name='srs_client_items'")
if [ "${1:-}" = "--check" ]; then
  echo "=== Check only: Stage 2 migration applied = $([ "$HAS" = "0" ] && echo no || echo yes). Nothing changed."
  exit 0
fi

if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-requirements-s2.sql
else
  echo "=== Migration already applied - skipped"
fi

echo "=== Seed"
Q -q -f migrations/2026-11-requirements-s2-seed.sql

echo "=== Result"
Q -c "select role::text, count(*) from users group by 1 order by 1"
Q -At -c "select 'ba in users_role_enum: ' || exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'users_role_enum' and e.enumlabel = 'ba')"
Q -c "select i.number, i.status, left(i.question, 60) as question, i.owner, string_agg(s.code, ', ' order by s.code) as stories
  from srs_client_items i join srs_documents d on d.id = i.\"srsId\" left join srs_client_item_stories l on l.\"itemId\" = i.id left join srs_stories s on s.id = l.\"storyId\"
  where d.\"projectId\" = 6 group by i.id order by i.number"
Q -c "select d.status, d.\"clientName\", (select count(*) from srs_stories s where s.\"srsId\" = d.id and s.\"atRisk\") as at_risk,
  (select count(*) from srs_stories s where s.\"srsId\" = d.id and s.status <> 'draft') as non_draft from srs_documents d where d.\"projectId\" = 6"
echo "REQUIREMENTS S2 MIGRATION DONE (expect: same user role counts as before, ba = t, 5 open items, 7 story links, status in_review, 0 at risk, 0 non-draft)"
