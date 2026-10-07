import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';

// Client portal Stage 2: raising, reading, replying to and working client
// tickets, over the real backend. Proves the client/project/number come
// from the server, internal notes never reach client users (responses or
// notifications), only the team can move a ticket, and every write is as
// isolated as the Stage 1 reads.
describe('Client tickets (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let tokenFor: (u: FixtureUser) => string;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    tokenFor = t.tokenFor;
    f = await seedFixtures(ds);
    await ds.query(`UPDATE "clients" SET "ticketPrefix" = 'AM' WHERE id = $1`, [f.clients.cA]);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = (u: FixtureUser) => ({ Authorization: `Bearer ${tokenFor(u)}` });
  const get = (u: FixtureUser, url: string) => http().get(url).set(auth(u));
  const post = (u: FixtureUser, url: string, body: any) => http().post(url).set(auth(u)).send(body);
  const patch = (u: FixtureUser, url: string, body: any) => http().patch(url).set(auth(u)).send(body);

  const newTicket = (overrides: Record<string, any> = {}) => ({
    category: 'bug',
    severity: 'major',
    priority: 'medium',
    moduleId: f.modules.mA,
    title: 'Claim totals are wrong',
    description: 'The total excludes the last line.',
    stepsToReproduce: 'Open a claim with 3 lines',
    expectedResult: 'All lines counted',
    ...overrides,
  });

  // Notifications are written by an event listener just after the request
  // returns - poll briefly rather than sleep.
  const notificationsFor = async (u: FixtureUser, type: string, expectAtLeast: number) => {
    for (let i = 0; i < 20; i++) {
      const rows = await ds.query(`SELECT * FROM "user_notifications" WHERE "userId" = $1 AND "type" = $2 ORDER BY id`, [u.id, type]);
      if (rows.length >= expectAtLeast) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return ds.query(`SELECT * FROM "user_notifications" WHERE "userId" = $1 AND "type" = $2 ORDER BY id`, [u.id, type]);
  };

  describe('GET /client-portal/me', () => {
    it('a switched-on client user gets their company and its active modules', async () => {
      const me = (await get(f.users.clientA, '/client-portal/me').expect(200)).body;
      expect(me.portalClient).toMatchObject({ id: f.clients.cA, name: 'Client A', ticketPrefix: 'AM' });
      expect(me.portalClient.modules).toEqual([{ id: f.modules.mA, name: 'Medical Claim' }]);
      expect(me.canSeeClientTickets).toBe(false);
    });

    it('client users whose portal is off, and legacy (LMS) clients, get no portal', async () => {
      for (const u of [f.users.clientC, f.users.legacyClient]) {
        expect((await get(u, '/client-portal/me').expect(200)).body).toEqual({ portalClient: null, teamClients: [], canSeeClientTickets: false });
      }
    });

    it('team members get only their clients; PM all; staff on no team nothing', async () => {
      const devA = (await get(f.users.devA, '/client-portal/me').expect(200)).body;
      expect(devA.teamClients.map((c: any) => c.id)).toEqual([f.clients.cA]);
      expect(devA.canSeeClientTickets).toBe(true);
      const pm = (await get(f.users.pm, '/client-portal/me').expect(200)).body;
      expect(pm.teamClients.map((c: any) => c.id).sort()).toEqual([f.clients.cA, f.clients.cB, f.clients.cC].sort());
      for (const u of [f.users.devNone, f.users.exec]) {
        expect((await get(u, '/client-portal/me').expect(200)).body.canSeeClientTickets).toBe(false);
      }
    });
  });

  describe('raising a ticket', () => {
    it('client, project and number come from the server, never the request', async () => {
      const res = await post(f.users.clientA, '/client-portal/tickets', newTicket({ clientId: f.clients.cB, projectId: f.projects.pB, number: 99, status: 'closed' })).expect(201);
      expect(res.body).toMatchObject({ clientId: f.clients.cA, projectId: f.projects.pA, number: 3, key: 'AM-3', status: 'submitted', moduleName: 'Medical Claim' });
      expect(res.body.events.map((e: any) => e.type)).toEqual(['created']);
    });

    it("refuses another project's module and inactive modules", async () => {
      await post(f.users.clientA, '/client-portal/tickets', newTicket({ moduleId: f.modules.mB })).expect(400);
      const [retired] = await ds.query(`SELECT id FROM "modules" WHERE "name" = 'Retired module'`);
      await post(f.users.clientA, '/client-portal/tickets', newTicket({ moduleId: retired.id })).expect(400);
    });

    it('validates the fields', async () => {
      await post(f.users.clientA, '/client-portal/tickets', newTicket({ title: '   ' })).expect(400);
      await post(f.users.clientA, '/client-portal/tickets', newTicket({ severity: 'urgent' })).expect(400);
      await post(f.users.clientA, '/client-portal/tickets', newTicket({ title: 'x'.repeat(121) })).expect(400);
    });

    it('steps and expected result are kept for bugs only', async () => {
      const q = (await post(f.users.clientA, '/client-portal/tickets', newTicket({ category: 'question' })).expect(201)).body;
      expect(q.stepsToReproduce).toBeNull();
      expect(q.expectedResult).toBeNull();
    });

    it('only switched-on client users can raise tickets', async () => {
      for (const u of [f.users.devA, f.users.pm, f.users.admin]) {
        await post(u, '/client-portal/tickets', newTicket()).expect(403);
      }
      await post(f.users.clientC, '/client-portal/tickets', newTicket()).expect(403);
      await post(f.users.legacyClient, '/client-portal/tickets', newTicket()).expect(403);
    });

    it('tickets submitted at the same moment get unique numbers', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => post(f.users.clientB, '/client-portal/tickets', newTicket({ moduleId: f.modules.mB, title: `Parallel ${i}` }))),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
      const numbers = results.map((r) => r.body.number).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(6);
      expect(numbers).toEqual([2, 3, 4, 5, 6, 7]);
    });

    it("notifies the client's team (not other teams) with a team link", async () => {
      const t = (await post(f.users.clientA, '/client-portal/tickets', newTicket({ title: 'Notify me' })).expect(201)).body;
      const rows = await notificationsFor(f.users.devA, 'clientTicket.created', 1);
      expect(rows.some((n: any) => n.link === `/client-tickets/${t.id}`)).toBe(true);
      const otherTeam = await notificationsFor(f.users.qaB, 'clientTicket.created', 0);
      expect(otherTeam.filter((n: any) => n.link === `/client-tickets/${t.id}`)).toEqual([]);
    });
  });

  describe('replies and internal notes', () => {
    it('client users never see internal notes; the team does', async () => {
      await post(f.users.devA, `/client-portal/tickets/${f.tickets.tA1}/comments`, { body: 'Root cause is the rounding job', isInternal: true }).expect(201);
      await post(f.users.devA, `/client-portal/tickets/${f.tickets.tA1}/comments`, { body: 'We are fixing this today' }).expect(201);

      for (const u of [f.users.clientA, f.users.clientA2]) {
        const body = (await get(u, `/client-portal/tickets/${f.tickets.tA1}`).expect(200)).body;
        expect(body.comments.map((c: any) => c.body)).toEqual(['We are fixing this today']);
        expect(JSON.stringify(body)).not.toContain('rounding job');
      }
      const team = (await get(f.users.devA, `/client-portal/tickets/${f.tickets.tA1}`).expect(200)).body;
      expect(team.comments.map((c: any) => [c.body, c.isInternal])).toEqual([
        ['Root cause is the rounding job', true],
        ['We are fixing this today', false],
      ]);
    });

    it('client users cannot post internal notes', async () => {
      await post(f.users.clientA, `/client-portal/tickets/${f.tickets.tA1}/comments`, { body: 'sneaky', isInternal: true }).expect(403);
    });

    it("nobody can reply on another client's ticket - it's not found", async () => {
      await post(f.users.clientA, `/client-portal/tickets/${f.tickets.tB1}/comments`, { body: 'hi' }).expect(404);
      await post(f.users.devA, `/client-portal/tickets/${f.tickets.tB1}/comments`, { body: 'hi' }).expect(404);
      await post(f.users.qaB, `/client-portal/tickets/${f.tickets.tA1}/comments`, { body: 'hi' }).expect(404);
      await post(f.users.exec, `/client-portal/tickets/${f.tickets.tA1}/comments`, { body: 'hi' }).expect(404);
      await post(f.users.clientC, `/client-portal/tickets/${f.tickets.tC1}/comments`, { body: 'hi' }).expect(404);
      await post(f.users.pmT2, `/client-portal/tickets/${f.tickets.tA1}/comments`, { body: 'hi' }).expect(404);
    });

    it('internal notes never notify client users; team replies notify the ticket creator', async () => {
      const t = (await post(f.users.clientA2, '/client-portal/tickets', newTicket({ title: 'Reply flow' })).expect(201)).body;
      await post(f.users.devA, `/client-portal/tickets/${t.id}/comments`, { body: 'internal only', isInternal: true }).expect(201);
      await post(f.users.devA, `/client-portal/tickets/${t.id}/comments`, { body: 'public reply' }).expect(201);
      const replies = await notificationsFor(f.users.clientA2, 'clientTicket.teamReplied', 1);
      expect(replies.map((n: any) => n.link)).toContain(`/portal/tickets/${t.id}`);
      const clientRows = await ds.query(`SELECT * FROM "user_notifications" WHERE "userId" IN ($1, $2)`, [f.users.clientA.id, f.users.clientA2.id]);
      expect(clientRows.filter((n: any) => n.type === 'clientTicket.internalNote')).toEqual([]);
      expect(JSON.stringify(clientRows)).not.toContain('internal only');
    });

    it('client responses never include anyone\'s email', async () => {
      for (const url of ['/client-portal/tickets', `/client-portal/tickets/${f.tickets.tA1}`, '/client-portal/me']) {
        expect(JSON.stringify((await get(f.users.clientA, url).expect(200)).body)).not.toContain('@test.local');
      }
    });
  });

  describe('working a ticket (team only)', () => {
    it('client users cannot change status or assignee', async () => {
      await patch(f.users.clientA, `/client-portal/tickets/${f.tickets.tA2}`, { status: 'closed' }).expect(403);
      await patch(f.users.clientA, `/client-portal/tickets/${f.tickets.tA2}`, { assigneeUserId: f.users.devA.id }).expect(403);
      await patch(f.users.clientA, `/client-portal/tickets/${f.tickets.tB1}`, { status: 'closed' }).expect(404);
    });

    it("other teams and outsiders get not-found", async () => {
      await patch(f.users.qaB, `/client-portal/tickets/${f.tickets.tA2}`, { status: 'in_progress' }).expect(404);
      await patch(f.users.devNone, `/client-portal/tickets/${f.tickets.tA2}`, { status: 'in_progress' }).expect(404);
      await patch(f.users.exec, `/client-portal/tickets/${f.tickets.tA2}`, { status: 'in_progress' }).expect(404);
    });

    it("assignee must be on that client's team", async () => {
      await patch(f.users.devA, `/client-portal/tickets/${f.tickets.tA2}`, { assigneeUserId: f.users.qaB.id }).expect(400);
      await patch(f.users.devA, `/client-portal/tickets/${f.tickets.tA2}`, { assigneeUserId: f.users.devNone.id }).expect(400);
      const res = await patch(f.users.pm, `/client-portal/tickets/${f.tickets.tA2}`, { assigneeUserId: f.users.devA.id }).expect(200);
      expect(res.body.assigneeName).toBe('Name devA');
      expect(res.body.events.find((e: any) => e.type === 'assignee')).toMatchObject({ fromValue: null, toValue: 'Name devA' });
      const assigned = await notificationsFor(f.users.devA, 'clientTicket.assigned', 1);
      expect(assigned.map((n: any) => n.link)).toContain(`/client-tickets/${f.tickets.tA2}`);
    });

    it('only Stage 2 statuses can be set', async () => {
      for (const status of ['submitted', 'waiting_client', 'done']) {
        await patch(f.users.devA, `/client-portal/tickets/${f.tickets.tA2}`, { status }).expect(400);
      }
    });

    it('closing stamps closedAt, blocks client replies, and reopening clears it', async () => {
      const closed = (await patch(f.users.devA, `/client-portal/tickets/${f.tickets.tA2}`, { status: 'closed' }).expect(200)).body;
      expect(closed.closedAt).not.toBeNull();
      await post(f.users.clientA2, `/client-portal/tickets/${f.tickets.tA2}/comments`, { body: 'still broken' }).expect(400);
      const reopened = (await patch(f.users.devA, `/client-portal/tickets/${f.tickets.tA2}`, { status: 'in_progress' }).expect(200)).body;
      expect(reopened.closedAt).toBeNull();
      expect(reopened.events.filter((e: any) => e.type === 'status').map((e: any) => [e.fromValue, e.toValue])).toEqual([
        ['submitted', 'closed'],
        ['closed', 'in_progress'],
      ]);
      const notified = await notificationsFor(f.users.clientA2, 'clientTicket.statusChanged', 2);
      expect(notified.map((n: any) => n.link)).toContain(`/portal/tickets/${f.tickets.tA2}`);
    });

    it('team lists are scoped and newest activity comes first', async () => {
      const devA = (await get(f.users.devA, '/client-portal/tickets').expect(200)).body;
      expect(new Set(devA.map((t: any) => t.clientId))).toEqual(new Set([f.clients.cA]));
      expect(devA[0].id).toBe(f.tickets.tA2);
      const qaB = (await get(f.users.qaB, '/client-portal/tickets').expect(200)).body;
      expect(new Set(qaB.map((t: any) => t.clientId))).toEqual(new Set([f.clients.cB]));
    });
  });
});
