-- Client portal configuration for Amanah Insurance (confirmed with the
-- user 2026-10-07). Data only - run after 2026-10-client-portal-
-- foundation.sql. The portal stays OFF (portalEnabled = false) until the
-- Stage 2 screens ship, so this changes nothing anyone sees yet.
--
--   Project:     "Insurance" (id 2) - modules come from this project
--                (Medical Claim today; the PM adds more later)
--   Key contact: Mohamed Abdirahman (user 33, client role)
--   Team:        Javied (50, developer), Divyashree (8, QA),
--                Vignesh Selvaraj (4, PM)
--   Bhavani is LMS-only and deliberately not on this team. LMS and its
--   client user are not touched.
--
-- Users are matched by id AND name, so a mismatch inserts nothing rather
-- than the wrong person.
BEGIN;

INSERT INTO "clients" ("tenantId", "name", "projectId", "keyContactUserId", "portalEnabled", "isActive")
SELECT 1, 'Amanah Insurance', p."id", u."id", false, true
FROM "projects" p, "users" u
WHERE p."id" = 2 AND p."tenantId" = 1 AND p."name" = 'Insurance'
  AND u."id" = 33 AND u."tenantId" = 1 AND u."role" = 'client' AND u."fullName" = 'Mohamed Abdirahman';

INSERT INTO "client_users" ("tenantId", "clientId", "userId", "isKeyContact")
SELECT 1, c."id", 33, true FROM "clients" c WHERE c."tenantId" = 1 AND c."name" = 'Amanah Insurance';

INSERT INTO "client_team_members" ("tenantId", "clientId", "userId", "teamRole", "getsNewTickets", "ccAll")
SELECT 1, c."id", u."id", t.role, t.gets, t.cc
FROM "clients" c
JOIN (VALUES (50, 'Javied', 'developer', true, false),
             (8, 'Divyashree', 'qa', true, false),
             (4, 'Vignesh Selvaraj', 'pm', false, true)) AS t(uid, uname, role, gets, cc) ON true
JOIN "users" u ON u."id" = t.uid AND u."fullName" = t.uname AND u."tenantId" = 1
WHERE c."tenantId" = 1 AND c."name" = 'Amanah Insurance';

-- Expect exactly 1 client, 1 client user, 3 team members.
DO $$
BEGIN
  IF (SELECT count(*) FROM "clients" WHERE "tenantId" = 1 AND "name" = 'Amanah Insurance') <> 1
     OR (SELECT count(*) FROM "client_users") <> 1
     OR (SELECT count(*) FROM "client_team_members") <> 3 THEN
    RAISE EXCEPTION 'Amanah seed did not produce 1 client / 1 client user / 3 team members - rolled back';
  END IF;
END $$;

COMMIT;
