-- Removes ALL demo data added for the product presentation. Safe to run
-- any time after the demo - every statement is scoped to the markers
-- used when the data was created:
--   - Issues, projects, test cases: title/name prefixed "[DEMO] "
--   - The one demo user: email @demo.tracker.local
--
-- Nothing here touches real data - every WHERE clause matches only rows
-- created by seed-demo-issues.sql and the accompanying API calls.
-- user_projects rows for the demo projects/user are cleaned up
-- automatically via ON DELETE CASCADE when the projects/users below are
-- removed - no explicit step needed for that join table.

BEGIN;

-- Run history first (references test_cases), then the test cases themselves.
DELETE FROM test_executions
  WHERE "testCaseId" IN (SELECT id FROM test_cases WHERE title LIKE '[DEMO]%');
DELETE FROM test_cases WHERE title LIKE '[DEMO]%';

-- All demo issues, including the two dependency examples and the two
-- Client-submitted tickets (all title-prefixed the same way).
DELETE FROM issues WHERE title LIKE '[DEMO]%';

-- Modules belonging to a demo project.
DELETE FROM modules WHERE "projectId" IN (SELECT id FROM projects WHERE name LIKE '[DEMO]%');

-- Demo projects (cascades user_projects rows for real users' membership
-- in these specific projects - does not touch the users themselves or
-- their membership in any real project).
DELETE FROM projects WHERE name LIKE '[DEMO]%';

-- The one demo Client account (cascades its user_projects rows, of
-- which there are none, and its issues are already gone above since
-- they're also title-prefixed).
DELETE FROM users WHERE email LIKE '%@demo.tracker.local';

COMMIT;
