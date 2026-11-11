-- GitHub PR helpers (2026-11-11, approved by the user): on each task,
-- "Copy branch name", "Copy PR title" and "Open pull request" (GitHub's own
-- new-PR page, title pre-filled - Tracker never writes to GitHub). Behind
-- their own switch, OFF, and only for the listed projects (LMS first).
-- Independent of the GitHub releases switch ("enabled"). Additive only.
--   github_settings."prHelpersEnabled" (false) - the switch
--   github_settings."prHelperProjectIds" ([]) - projects that show them
--   github_settings."branchPrefix" ('feature/') - start of copied branch names
-- Run once (the apply script skips it if prHelpersEnabled already exists).
-- Rollback: 2026-11-github-pr-helpers.down.sql.
BEGIN;
ALTER TABLE "github_settings" ADD COLUMN "prHelpersEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "github_settings" ADD COLUMN "prHelperProjectIds" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "github_settings" ADD COLUMN "branchPrefix" character varying(30) NOT NULL DEFAULT 'feature/';
ALTER TABLE "github_settings" ADD CONSTRAINT "CHK_github_settings_branch_prefix" CHECK ("branchPrefix" ~ '^[a-z0-9][a-z0-9._-]{0,28}/$');
COMMIT;
