#!/usr/bin/env bash
# Requirements traceability Stage 1: 8 new srs_* tables, the
# team_settings."requirementsTree" switch (OFF), then the Lien SRS v1.0 seed
# for LMS (project #6).
#
#   ./2026-11-requirements-s1-apply.sh --check   read-only: shows project #6,
#                                                the reviewer match and what
#                                                is already applied. Changes
#                                                nothing, takes no backup.
#   ./2026-11-requirements-s1-apply.sh           backup, migrate, seed, report
#
# Takes a fresh backup first (../db-backup.sh) and stops if it fails - this
# is the only backup, don't run db-backup.sh before it. Run it BEFORE the
# deploy - the new code reads the new tables. Safe to run again: skips the
# migration if srs_documents exists and the seed if the SRS is already there.
# Rollback: 2026-11-requirements-s1.down.sql.
set -euo pipefail
cd /home/ec2-user/tracker/backend
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
Q() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "=== Project #6 and reviewer (must be LMS, and exactly one PM named Vignesh)"
Q -c "select id, name, \"tenantId\" from projects where id = 6"
Q -c "select u.id, u.\"fullName\", u.role from users u join projects p on p.\"tenantId\" = u.\"tenantId\" where p.id = 6 and u.role::text = 'program_manager' and u.\"fullName\" ilike 'Vignesh%'"

HAS=$(Q -At -c "select count(*) from information_schema.tables where table_name='srs_documents'")
if [ "${1:-}" = "--check" ]; then
  echo "=== Check only: migration applied = $([ "$HAS" = "0" ] && echo no || echo yes). Nothing changed."
  exit 0
fi

if [ "$HAS" = "0" ]; then
  echo "=== Backup"
  ../db-backup.sh
  echo "=== Migration"
  Q -q -f migrations/2026-11-requirements-s1.sql
else
  echo "=== Migration already applied - skipped"
fi

echo "=== Seed"
Q -q -f migrations/2026-11-requirements-s1-seed.sql

echo "=== Result"
Q -c "select column_name, column_default from information_schema.columns where table_name='team_settings' and column_name='requirementsTree'"
Q -c "select d.id, d.name, d.version, d.status, d.\"issuedOn\", d.\"reviewerUserIds\",
  (select count(*) from srs_requirements r where r.\"srsId\" = d.id) as requirements,
  (select count(*) from srs_epics e where e.\"srsId\" = d.id) as epics,
  (select count(*) from srs_stories s where s.\"srsId\" = d.id) as stories,
  (select count(*) from srs_stories s where s.\"srsId\" = d.id and s.status <> 'draft') as non_draft,
  (select count(*) from srs_criteria c join srs_stories s on s.id = c.\"storyId\" where s.\"srsId\" = d.id) as criteria,
  (select count(*) from srs_criteria c join srs_stories s on s.id = c.\"storyId\" where s.\"srsId\" = d.id and c.result <> 'not_run') as with_result,
  (select count(*) from srs_story_requirements l join srs_stories s on s.id = l.\"storyId\" where s.\"srsId\" = d.id) as links,
  (select count(*) from srs_story_tickets) as tickets
  from srs_documents d where d.\"projectId\" = 6"
echo "REQUIREMENTS S1 MIGRATION DONE (expect 40 / 6 / 23 / 0 / 65 / 0 / 41 / 0)"
