-- Widen issues.category from a fixed Postgres enum to free text, loosely
-- backed by the issue_categories lookup table (matched by name, not a
-- real FK - see backend/src/issue-categories). Existing values are
-- preserved as-is by the USING cast.
ALTER TABLE "issues" ALTER COLUMN "category" TYPE character varying USING "category"::text;
DROP TYPE IF EXISTS "issues_category_enum";

-- Seed the same 6 names the old enum had, one row per existing tenant, so
-- every existing issue's category has a matching catalog entry and the
-- New/Edit Issue dropdowns aren't empty on first load.
INSERT INTO "issue_categories" ("tenantId", "name", "isActive")
SELECT t.id, c.name, true
FROM "tenants" t
CROSS JOIN (VALUES ('New Feature'), ('Enhancement'), ('Bug'), ('Critical'), ('Showstopper'), ('Defect')) AS c(name)
ON CONFLICT ("tenantId", "name") DO NOTHING;
