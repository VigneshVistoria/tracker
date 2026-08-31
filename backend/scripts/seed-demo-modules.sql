-- Demo module rows for product presentation - creates the exact module
-- ids (3-7) that seed-demo-issues.sql's issue rows already reference by
-- id. Run this script BEFORE seed-demo-issues.sql. Additive only - no
-- existing rows are touched. Cleaned up by remove-demo-data.sql, which
-- already deletes from "modules" by projectId of any "[DEMO]%" project.
--
-- Assumes demo projects 24 ([DEMO] Retail POS Revamp) and 25
-- ([DEMO] Mobile Banking App) already exist, same assumption
-- seed-demo-issues.sql makes about its own project/user ids.
BEGIN;

INSERT INTO modules (id, "projectId", "projectName", name, description, "createdByUserId", "tenantId", "createdAt")
OVERRIDING SYSTEM VALUE VALUES
(3, 24, '[DEMO] Retail POS Revamp', 'Checkout Flow', 'The in-store checkout experience, from scan to payment.', 4, 1, now() - interval '20 days'),
(4, 24, '[DEMO] Retail POS Revamp', 'Inventory Sync', 'Keeping on-hand stock counts accurate across stores.', 4, 1, now() - interval '20 days'),
(5, 24, '[DEMO] Retail POS Revamp', 'Receipt Printing', 'Printed and emailed receipt generation.', 4, 1, now() - interval '20 days'),
(6, 25, '[DEMO] Mobile Banking App', 'Authentication', 'Login, biometrics, and session handling.', 4, 1, now() - interval '15 days'),
(7, 25, '[DEMO] Mobile Banking App', 'Transactions', 'Transfers, statements, and transaction history.', 4, 1, now() - interval '15 days');

-- Keep the id sequence past 7 so the next real POST /modules call
-- doesn't collide with the hardcoded demo ids above.
SELECT setval('modules_id_seq', (SELECT MAX(id) FROM modules));

COMMIT;
