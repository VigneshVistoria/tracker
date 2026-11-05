-- Design artifact types (2026-11-05): a Designer's submission can attach a
-- Design file, a Prototype or a Design spec. Additive only - existing rows
-- and the 7 existing values are untouched. Safe to run again (IF NOT EXISTS).
-- Down: Postgres can't drop an enum value; the extra values are harmless
-- if unused. See 2026-11-design-artifact-types.down.sql.
ALTER TYPE task_qa_reviews_artifacttype_enum ADD VALUE IF NOT EXISTS 'Design file';
ALTER TYPE task_qa_reviews_artifacttype_enum ADD VALUE IF NOT EXISTS 'Prototype';
ALTER TYPE task_qa_reviews_artifacttype_enum ADD VALUE IF NOT EXISTS 'Design spec';
