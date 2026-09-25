-- Adds test_cases.caseNumber (auto-generated "TC-0001" style human-
-- readable ID, derived from the row's own numeric id right after insert
-- - see TestCasesService's assignCaseNumber()) and moduleId/moduleName +
-- phaseId/phaseName (same plain-column + denormalized-name convention
-- ProjectTask already uses for Project/Module/Phase). Unlike ProjectTask,
-- Module/Phase stay optional here, same as Project already is on
-- TestCase - a test case doesn't have to be scoped that granularly.
-- test_cases is empty in production as of this migration, so no backfill
-- is needed for the new unique caseNumber column.
ALTER TABLE "test_cases" ADD COLUMN "caseNumber" character varying;
ALTER TABLE "test_cases" ADD CONSTRAINT "UQ_test_cases_caseNumber" UNIQUE ("caseNumber");
ALTER TABLE "test_cases" ADD COLUMN "moduleId" integer;
ALTER TABLE "test_cases" ADD COLUMN "moduleName" character varying;
ALTER TABLE "test_cases" ADD COLUMN "phaseId" integer;
ALTER TABLE "test_cases" ADD COLUMN "phaseName" character varying;
