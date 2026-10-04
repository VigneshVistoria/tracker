-- Adds task_dependency_tickets.title - added nullable first so every
-- existing row can be backfilled (scripts/backfill-task-dependency-ticket-
-- titles.js, generated from each ticket's description) before the column
-- is locked to NOT NULL. Same three-step rollout as 2026-09-task-title.sql.
-- Run in this order: this migration, then the backfill script, then the
-- companion 2026-10-task-dependency-ticket-title-not-null.sql migration.
ALTER TABLE "task_dependency_tickets" ADD COLUMN "title" character varying;
