-- Adds project_tasks.title - added nullable first so every existing row
-- can be backfilled (see scripts/backfill-task-titles.ts, generated from
-- each task's description) before the column is locked to NOT NULL.
-- Run in this order: this migration, then the backfill script, then the
-- companion 2026-09-task-title-not-null.sql migration.
ALTER TABLE "project_tasks" ADD COLUMN "title" character varying;
