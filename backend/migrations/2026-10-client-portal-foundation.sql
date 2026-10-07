-- Client portal, Stage 1 (2026-10-07): data model only. New tables only -
-- nothing existing is altered, so LMS and every current workflow are
-- untouched. A client's portal stays off (portalEnabled = false) until
-- the Stage 2 screens ship. See src/client-portal/.
BEGIN;

CREATE TABLE "clients" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "name" character varying(200) NOT NULL,
  "projectId" integer NOT NULL,
  "keyContactUserId" integer,
  "portalEnabled" boolean NOT NULL DEFAULT false,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_clients_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_clients_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id"),
  CONSTRAINT "FK_clients_key_contact" FOREIGN KEY ("keyContactUserId") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "UQ_clients_tenant_name" UNIQUE ("tenantId", "name")
);

-- One company per client user.
CREATE TABLE "client_users" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "clientId" integer NOT NULL,
  "userId" integer NOT NULL,
  "isKeyContact" boolean NOT NULL DEFAULT false,
  "department" character varying(120),
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_client_users_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_client_users_client" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_client_users_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "UQ_client_users_user" UNIQUE ("userId")
);

CREATE TABLE "client_team_members" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "clientId" integer NOT NULL,
  "userId" integer NOT NULL,
  "teamRole" character varying(20) NOT NULL,
  "getsNewTickets" boolean NOT NULL DEFAULT true,
  "ccAll" boolean NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_client_team_members_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_client_team_members_client" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_client_team_members_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "UQ_client_team_members_client_user" UNIQUE ("clientId", "userId"),
  CONSTRAINT "CHK_client_team_members_role" CHECK ("teamRole" IN ('developer', 'qa', 'pm'))
);
CREATE INDEX "IDX_client_team_members_user" ON "client_team_members" ("userId");

CREATE TABLE "client_tickets" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "clientId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "moduleId" integer,
  "number" integer NOT NULL,
  "category" character varying(30) NOT NULL,
  "severity" character varying(20) NOT NULL,
  "priority" character varying(10) NOT NULL,
  "title" character varying(120) NOT NULL,
  "description" text NOT NULL,
  "status" character varying(20) NOT NULL DEFAULT 'submitted',
  "createdByUserId" integer NOT NULL,
  "assigneeUserId" integer,
  "closedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_client_tickets_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_client_tickets_client" FOREIGN KEY ("clientId") REFERENCES "clients"("id"),
  CONSTRAINT "FK_client_tickets_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id"),
  CONSTRAINT "FK_client_tickets_module" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE SET NULL,
  CONSTRAINT "FK_client_tickets_created_by" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id"),
  CONSTRAINT "FK_client_tickets_assignee" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "UQ_client_tickets_client_number" UNIQUE ("clientId", "number"),
  CONSTRAINT "CHK_client_tickets_category" CHECK ("category" IN ('bug', 'change_request', 'question', 'support')),
  CONSTRAINT "CHK_client_tickets_severity" CHECK ("severity" IN ('showstopper', 'critical', 'major', 'minor')),
  CONSTRAINT "CHK_client_tickets_priority" CHECK ("priority" IN ('low', 'medium', 'high')),
  CONSTRAINT "CHK_client_tickets_status" CHECK ("status" IN ('submitted', 'in_progress', 'waiting_client', 'client_review', 'closed'))
);
CREATE INDEX "IDX_client_tickets_client_created" ON "client_tickets" ("clientId", "createdAt" DESC);

CREATE TABLE "client_requests" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "clientId" integer NOT NULL,
  "ticketId" integer NOT NULL,
  "title" character varying(200) NOT NULL,
  "details" text,
  "requestedByUserId" integer NOT NULL,
  "sentToUserId" integer NOT NULL,
  "replyBy" date,
  "status" character varying(20) NOT NULL DEFAULT 'open',
  "answeredAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_client_requests_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_client_requests_client" FOREIGN KEY ("clientId") REFERENCES "clients"("id"),
  CONSTRAINT "FK_client_requests_ticket" FOREIGN KEY ("ticketId") REFERENCES "client_tickets"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_client_requests_requested_by" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id"),
  CONSTRAINT "FK_client_requests_sent_to" FOREIGN KEY ("sentToUserId") REFERENCES "users"("id"),
  CONSTRAINT "CHK_client_requests_status" CHECK ("status" IN ('open', 'answered'))
);
CREATE INDEX "IDX_client_requests_client_created" ON "client_requests" ("clientId", "createdAt" DESC);

COMMIT;
