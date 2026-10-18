-- Sign-in sessions for the web app (2026-10-18). One row per browser
-- sign-in. The browser holds a random refresh token in an httpOnly cookie;
-- only its SHA-256 hash is stored here. Each refresh swaps it for a new one
-- ("tokenHash" becomes "previousTokenHash" for a short grace window so two
-- tabs refreshing at once don't trip reuse detection). A previous token
-- presented after the grace window means it was copied - the whole
-- session is revoked. New table only; no existing table is changed.
BEGIN;
CREATE TABLE "refresh_sessions" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "userId" integer NOT NULL,
  "tokenHash" character varying(64) NOT NULL,
  "previousTokenHash" character varying(64),
  "rotatedAt" TIMESTAMP,
  "lastUsedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMP NOT NULL,
  "absoluteExpiresAt" TIMESTAMP NOT NULL,
  "revokedAt" TIMESTAMP,
  "revokedReason" character varying(32),
  "userAgent" character varying(300),
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "FK_refresh_sessions_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");
ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "FK_refresh_sessions_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "IDX_refresh_sessions_token" ON "refresh_sessions" ("tokenHash");
CREATE INDEX "IDX_refresh_sessions_previous" ON "refresh_sessions" ("previousTokenHash") WHERE "previousTokenHash" IS NOT NULL;
CREATE INDEX "IDX_refresh_sessions_user" ON "refresh_sessions" ("userId");
COMMIT;
