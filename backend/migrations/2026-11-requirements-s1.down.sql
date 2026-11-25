-- Rollback for 2026-11-requirements-s1.sql (and its seed). Drops every
-- Requirements table, including any Pass/Fail history recorded since, and
-- the requirements_tree switch. Deploy the previous code first.
BEGIN;
DROP TABLE IF EXISTS "srs_story_tickets";
DROP TABLE IF EXISTS "srs_criterion_results";
DROP FUNCTION IF EXISTS tracker_srs_history_is_append_only();
DROP TABLE IF EXISTS "srs_criteria";
DROP TABLE IF EXISTS "srs_story_requirements";
DROP TABLE IF EXISTS "srs_stories";
DROP TABLE IF EXISTS "srs_epics";
DROP TABLE IF EXISTS "srs_requirements";
DROP TABLE IF EXISTS "srs_documents";
ALTER TABLE "team_settings" DROP COLUMN IF EXISTS "requirementsTree";
COMMIT;
