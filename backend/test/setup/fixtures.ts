import { DataSource } from 'typeorm';

export interface FixtureUser {
  id: number;
  email: string;
  tenantId: number;
  role: string;
}

// Two tenants. In tenant 1, three portal clients:
//   A  - portal ON  (like Amanah)          team: devA (developer), pm
//   B  - portal ON                          team: qaB (QA)
//   C  - portal OFF (configured, not live)  user: clientC
// plus an LMS-style project whose client user (legacyClient) is not on
// any portal client at all and must keep today's behaviour exactly.
// Tenant 2 has its own PM and client, to prove tenants never mix.
export async function seedFixtures(ds: DataSource) {
  const one = async (sql: string, params: any[] = []) => (await ds.query(sql, params))[0];

  await ds.query(`TRUNCATE "client_ticket_attachments", "client_ticket_events", "client_ticket_comments", "client_requests", "client_tickets", "client_team_members", "client_users", "clients",
    "user_projects", "modules", "projects", "users", "tenants" RESTART IDENTITY CASCADE`);

  const t1 = (await one(`INSERT INTO "tenants" ("name", "subdomain") VALUES ('Tenant One', 't1') RETURNING id`)).id;
  const t2 = (await one(`INSERT INTO "tenants" ("name", "subdomain") VALUES ('Tenant Two', 't2') RETURNING id`)).id;

  const project = async (tenantId: number, name: string) =>
    (await one(`INSERT INTO "projects" ("tenantId", "name") VALUES ($1, $2) RETURNING id`, [tenantId, name])).id as number;
  const pA = await project(t1, 'Project A');
  const pB = await project(t1, 'Project B');
  const pC = await project(t1, 'Project C');
  const pLms = await project(t1, 'LMS');
  const pT2 = await project(t2, 'Tenant Two Project');

  const module = async (tenantId: number, projectId: number, name: string, isActive = true) =>
    (await one(`INSERT INTO "modules" ("tenantId", "projectId", "name", "isActive") VALUES ($1, $2, $3, $4) RETURNING id`, [tenantId, projectId, name, isActive])).id as number;
  const mA = await module(t1, pA, 'Medical Claim');
  await module(t1, pA, 'Retired module', false);
  const mB = await module(t1, pB, 'Motor');
  await module(t1, pLms, 'LMS Module');

  const users: Record<string, FixtureUser> = {};
  const user = async (key: string, tenantId: number, role: string, projects: number[] = []) => {
    const email = `${key}@test.local`;
    const row = await one(
      `INSERT INTO "users" ("tenantId", "email", "passwordHash", "fullName", "role") VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
      [tenantId, email, `Name ${key}`, role],
    );
    for (const p of projects) await ds.query(`INSERT INTO "user_projects" ("usersId", "projectsId") VALUES ($1, $2)`, [row.id, p]);
    users[key] = { id: row.id, email, tenantId, role };
  };
  await user('admin', t1, 'admin');
  await user('pm', t1, 'program_manager', [pA, pB, pC, pLms]);
  await user('exec', t1, 'executive');
  await user('devA', t1, 'developer', [pA, pLms]);
  await user('qaB', t1, 'qa', [pB, pLms]);
  await user('devNone', t1, 'developer', [pLms]);
  await user('clientA', t1, 'client', [pA]);
  await user('clientA2', t1, 'client', [pA]);
  await user('clientB', t1, 'client', [pB]);
  await user('clientC', t1, 'client', [pC]);
  await user('legacyClient', t1, 'client', [pLms]);
  await user('pmT2', t2, 'program_manager', [pT2]);
  await user('clientT2', t2, 'client', [pT2]);

  const client = async (tenantId: number, name: string, projectId: number, portalEnabled: boolean) =>
    (await one(`INSERT INTO "clients" ("tenantId", "name", "projectId", "portalEnabled") VALUES ($1, $2, $3, $4) RETURNING id`, [tenantId, name, projectId, portalEnabled])).id as number;
  const cA = await client(t1, 'Client A', pA, true);
  const cB = await client(t1, 'Client B', pB, true);
  const cC = await client(t1, 'Client C', pC, false);
  const cT2 = await client(t2, 'Tenant Two Client', pT2, true);

  const clientUser = (clientId: number, u: FixtureUser, isKeyContact = false) =>
    ds.query(`INSERT INTO "client_users" ("tenantId", "clientId", "userId", "isKeyContact") VALUES ($1, $2, $3, $4)`, [u.tenantId, clientId, u.id, isKeyContact]);
  await clientUser(cA, users.clientA, true);
  await clientUser(cA, users.clientA2);
  await clientUser(cB, users.clientB, true);
  await clientUser(cC, users.clientC, true);
  await clientUser(cT2, users.clientT2, true);

  const member = (clientId: number, u: FixtureUser, teamRole: string) =>
    ds.query(`INSERT INTO "client_team_members" ("tenantId", "clientId", "userId", "teamRole") VALUES ($1, $2, $3, $4)`, [u.tenantId, clientId, u.id, teamRole]);
  await member(cA, users.devA, 'developer');
  await member(cA, users.pm, 'pm');
  await member(cB, users.qaB, 'qa');

  const ticket = async (tenantId: number, clientId: number, projectId: number, moduleId: number | null, number: number, createdBy: FixtureUser) =>
    (await one(
      `INSERT INTO "client_tickets" ("tenantId", "clientId", "projectId", "moduleId", "number", "category", "severity", "priority", "title", "description", "createdByUserId")
        VALUES ($1, $2, $3, $4, $5, 'bug', 'major', 'medium', $6, 'details', $7) RETURNING id`,
      [tenantId, clientId, projectId, moduleId, number, `Ticket ${clientId}-${number}`, createdBy.id],
    )).id as number;
  const tA1 = await ticket(t1, cA, pA, mA, 1, users.clientA);
  const tA2 = await ticket(t1, cA, pA, mA, 2, users.clientA2);
  const tB1 = await ticket(t1, cB, pB, mB, 1, users.clientB);
  const tC1 = await ticket(t1, cC, pC, null, 1, users.clientC);
  const tT2 = await ticket(t2, cT2, pT2, null, 1, users.clientT2);

  const request = async (tenantId: number, clientId: number, ticketId: number, by: FixtureUser, to: FixtureUser) =>
    (await one(
      `INSERT INTO "client_requests" ("tenantId", "clientId", "ticketId", "title", "requestedByUserId", "sentToUserId") VALUES ($1, $2, $3, 'Need info', $4, $5) RETURNING id`,
      [tenantId, clientId, ticketId, by.id, to.id],
    )).id as number;
  const rA1 = await request(t1, cA, tA1, users.devA, users.clientA);
  const rB1 = await request(t1, cB, tB1, users.qaB, users.clientB);
  const rT2 = await request(t2, cT2, tT2, users.pmT2, users.clientT2);

  return {
    tenants: { t1, t2 },
    projects: { pA, pB, pC, pLms, pT2 },
    modules: { mA, mB },
    clients: { cA, cB, cC, cT2 },
    tickets: { tA1, tA2, tB1, tC1, tT2 },
    requests: { rA1, rB1, rT2 },
    users,
  };
}

export type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;
