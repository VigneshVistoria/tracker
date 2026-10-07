import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures, FixtureUser } from './setup/fixtures';
import { EventsGateway } from '../src/events/events.gateway';

// Client portal Stage 1: proves over the real backend (every module,
// guard and query) that client A can never see client B, that each role
// sees exactly what the access rules say, that client-portal users are
// kept out of internal endpoints and live updates - and that everyone
// else (LMS client users, staff) behaves exactly as before.
describe('Client portal isolation (e2e)', () => {
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
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (u: FixtureUser, url: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${tokenFor(u)}`);
  const ids = (body: any[]) => body.map((r) => r.id).sort((a, b) => a - b);

  describe('clients', () => {
    it('Admin and PM see every client in their tenant, never another tenant', async () => {
      for (const u of [f.users.admin, f.users.pm]) {
        const res = await get(u, '/client-portal/clients').expect(200);
        expect(ids(res.body)).toEqual([f.clients.cA, f.clients.cB, f.clients.cC].sort((a, b) => a - b));
      }
      await get(f.users.pm, `/client-portal/clients/${f.clients.cT2}`).expect(404);
      const t2 = await get(f.users.pmT2, '/client-portal/clients').expect(200);
      expect(ids(t2.body)).toEqual([f.clients.cT2]);
    });

    it('team members see only their own clients', async () => {
      expect(ids((await get(f.users.devA, '/client-portal/clients').expect(200)).body)).toEqual([f.clients.cA]);
      expect(ids((await get(f.users.qaB, '/client-portal/clients').expect(200)).body)).toEqual([f.clients.cB]);
    });

    it('staff on no client team, and executives, see no clients', async () => {
      for (const u of [f.users.devNone, f.users.exec]) {
        expect((await get(u, '/client-portal/clients').expect(200)).body).toEqual([]);
      }
    });

    it('a client user sees only their own company', async () => {
      expect(ids((await get(f.users.clientA, '/client-portal/clients').expect(200)).body)).toEqual([f.clients.cA]);
      expect(ids((await get(f.users.clientB, '/client-portal/clients').expect(200)).body)).toEqual([f.clients.cB]);
    });

    it('client users whose portal is off, and legacy (LMS) client users, see no portal clients', async () => {
      for (const u of [f.users.clientC, f.users.legacyClient]) {
        expect((await get(u, '/client-portal/clients').expect(200)).body).toEqual([]);
      }
    });

    it('opening another client by id is "not found" for client users and other teams', async () => {
      await get(f.users.clientA, `/client-portal/clients/${f.clients.cB}`).expect(404);
      await get(f.users.clientB, `/client-portal/clients/${f.clients.cA}`).expect(404);
      await get(f.users.devA, `/client-portal/clients/${f.clients.cB}`).expect(404);
      await get(f.users.qaB, `/client-portal/clients/${f.clients.cA}`).expect(404);
      await get(f.users.clientA, '/client-portal/clients/999999').expect(404);
    });

    it('client detail: team and active modules; staff emails hidden from client users', async () => {
      const asPm = (await get(f.users.pm, `/client-portal/clients/${f.clients.cA}`).expect(200)).body;
      expect(asPm.modules).toEqual([{ id: f.modules.mA, name: 'Medical Claim' }]);
      expect(asPm.team.map((m: any) => m.teamRole).sort()).toEqual(['developer', 'pm']);
      expect(asPm.team.every((m: any) => typeof m.email === 'string')).toBe(true);

      const asClient = (await get(f.users.clientA, `/client-portal/clients/${f.clients.cA}`).expect(200)).body;
      expect(asClient.team.length).toBe(2);
      expect(asClient.team.some((m: any) => 'email' in m)).toBe(false);
    });
  });

  describe('tickets', () => {
    it('client A sees only client A tickets (from every colleague), never B or another tenant', async () => {
      const res = await get(f.users.clientA, '/client-portal/tickets').expect(200);
      expect(ids(res.body)).toEqual([f.tickets.tA1, f.tickets.tA2].sort((a, b) => a - b));
      expect(res.body.every((t: any) => t.clientId === f.clients.cA)).toBe(true);
    });

    it('asking for another client by clientId returns nothing', async () => {
      expect((await get(f.users.clientA, `/client-portal/tickets?clientId=${f.clients.cB}`).expect(200)).body).toEqual([]);
      expect((await get(f.users.devA, `/client-portal/tickets?clientId=${f.clients.cB}`).expect(200)).body).toEqual([]);
    });

    it("opening another client's ticket by id is 404 - same as a ticket that doesn't exist", async () => {
      for (const id of [f.tickets.tB1, f.tickets.tC1, f.tickets.tT2]) {
        await get(f.users.clientA, `/client-portal/tickets/${id}`).expect(404);
      }
      await get(f.users.clientB, `/client-portal/tickets/${f.tickets.tA1}`).expect(404);
      const missing = await get(f.users.clientA, '/client-portal/tickets/999999').expect(404);
      const other = await get(f.users.clientA, `/client-portal/tickets/${f.tickets.tB1}`).expect(404);
      expect(other.body).toEqual(missing.body);
    });

    it('a client user can open their own company tickets', async () => {
      const t = (await get(f.users.clientA, `/client-portal/tickets/${f.tickets.tA2}`).expect(200)).body;
      expect(t.clientId).toBe(f.clients.cA);
    });

    it('team members see only their clients; PM sees all; others none', async () => {
      expect(ids((await get(f.users.devA, '/client-portal/tickets').expect(200)).body)).toEqual([f.tickets.tA1, f.tickets.tA2].sort((a, b) => a - b));
      expect(ids((await get(f.users.qaB, '/client-portal/tickets').expect(200)).body)).toEqual([f.tickets.tB1]);
      await get(f.users.devA, `/client-portal/tickets/${f.tickets.tB1}`).expect(404);
      await get(f.users.qaB, `/client-portal/tickets/${f.tickets.tA1}`).expect(404);
      expect(ids((await get(f.users.pm, '/client-portal/tickets').expect(200)).body)).toEqual(
        [f.tickets.tA1, f.tickets.tA2, f.tickets.tB1, f.tickets.tC1].sort((a, b) => a - b),
      );
      for (const u of [f.users.devNone, f.users.exec, f.users.clientC, f.users.legacyClient]) {
        expect((await get(u, '/client-portal/tickets').expect(200)).body).toEqual([]);
      }
      await get(f.users.pm, `/client-portal/tickets/${f.tickets.tT2}`).expect(404);
    });
  });

  describe('requests (Request info)', () => {
    it('client A sees only client A requests; B and other tenants are 404', async () => {
      expect(ids((await get(f.users.clientA, '/client-portal/requests').expect(200)).body)).toEqual([f.requests.rA1]);
      await get(f.users.clientA, `/client-portal/requests/${f.requests.rB1}`).expect(404);
      await get(f.users.clientA, `/client-portal/requests/${f.requests.rT2}`).expect(404);
      await get(f.users.clientB, `/client-portal/requests/${f.requests.rA1}`).expect(404);
      await get(f.users.clientA, `/client-portal/requests/${f.requests.rA1}`).expect(200);
    });

    it('teams see only their clients; PM sees all in the tenant', async () => {
      expect(ids((await get(f.users.devA, '/client-portal/requests').expect(200)).body)).toEqual([f.requests.rA1]);
      expect(ids((await get(f.users.qaB, '/client-portal/requests').expect(200)).body)).toEqual([f.requests.rB1]);
      expect(ids((await get(f.users.pm, '/client-portal/requests').expect(200)).body)).toEqual([f.requests.rA1, f.requests.rB1].sort((a, b) => a - b));
      expect((await get(f.users.devNone, '/client-portal/requests').expect(200)).body).toEqual([]);
    });
  });

  describe('portal client users are kept out of internal endpoints', () => {
    const internal = (id: number, projectId: number) => [
      '/issues',
      `/issues/${id}`,
      '/issues/bulk-export',
      '/sprints',
      '/modules',
      `/projects/${projectId}/overview`,
      `/modules/${id}/overview`,
      '/users/assignable',
    ];

    it('client A and client B get 403 on every internal endpoint', async () => {
      for (const u of [f.users.clientA, f.users.clientB]) {
        for (const url of internal(1, f.projects.pA)) {
          const res = await get(u, url);
          expect({ url, status: res.status }).toEqual({ url, status: 403 });
        }
      }
    });

    it('unchanged: a legacy (LMS) client user still reaches them exactly as before', async () => {
      expect((await get(f.users.legacyClient, '/issues')).status).toBe(200);
      expect((await get(f.users.legacyClient, '/users/assignable')).status).toBe(200);
    });

    it('unchanged: a client whose portal is still off is not affected', async () => {
      expect((await get(f.users.clientC, '/issues')).status).toBe(200);
    });

    it('unchanged: staff, including client team members, are not affected', async () => {
      for (const u of [f.users.devA, f.users.qaB, f.users.pm, f.users.devNone]) {
        expect((await get(u, '/issues')).status).toBe(200);
        expect((await get(u, '/users/assignable')).status).toBe(200);
      }
    });

    it('switching a client portal on takes effect immediately, and off again restores the old behaviour', async () => {
      await ds.query(`UPDATE "clients" SET "portalEnabled" = true WHERE id = $1`, [f.clients.cC]);
      expect((await get(f.users.clientC, '/issues')).status).toBe(403);
      expect(ids((await get(f.users.clientC, '/client-portal/tickets').expect(200)).body)).toEqual([f.tickets.tC1]);
      await ds.query(`UPDATE "clients" SET "portalEnabled" = false WHERE id = $1`, [f.clients.cC]);
      expect((await get(f.users.clientC, '/issues')).status).toBe(200);
      expect((await get(f.users.clientC, '/client-portal/tickets').expect(200)).body).toEqual([]);
    });
  });

  describe('live updates (socket rooms)', () => {
    const connect = async (u: FixtureUser | null, token?: string) => {
      const gateway = app.get(EventsGateway);
      const rooms: string[] = [];
      const socket: any = {
        id: 'test',
        handshake: { auth: { token: token ?? (u ? tokenFor(u) : undefined) } },
        join: (room: string) => rooms.push(room),
        disconnected: false,
        disconnect() {
          this.disconnected = true;
        },
      };
      await gateway.handleConnection(socket);
      return { rooms, disconnected: socket.disconnected };
    };

    it('portal client users never join the tenant-wide room, only their personal one', async () => {
      for (const u of [f.users.clientA, f.users.clientB]) {
        const { rooms, disconnected } = await connect(u);
        expect(disconnected).toBe(false);
        expect(rooms).toEqual([`user:${u.id}`]);
      }
    });

    it('unchanged: staff and legacy client users still join the tenant room', async () => {
      for (const u of [f.users.devA, f.users.pm, f.users.legacyClient, f.users.clientC]) {
        const { rooms } = await connect(u);
        expect(rooms).toEqual([`tenant:${u.tenantId}`, `user:${u.id}`]);
      }
    });

    it('a bad token is disconnected', async () => {
      const { rooms, disconnected } = await connect(null, 'not-a-token');
      expect(disconnected).toBe(true);
      expect(rooms).toEqual([]);
    });
  });
});
