import { NotFoundException } from '@nestjs/common';
import { ClientAccessService } from '../src/client-portal/client-access.service';

// Unit tests of the access rules alone (no database): which clients each
// kind of user may see. The end-to-end proof over real endpoints is in
// client-isolation.e2e-spec.ts.
function makeService(opts: {
  teamRows?: Array<{ clientId: number }>;
  activeClientIds?: number[];
  portalMembership?: { clientId: number } | null;
}) {
  const clientsRepo: any = {
    find: jest.fn(async ({ where }: any) =>
      (opts.activeClientIds ?? []).filter((id) => where.id.value.includes(id)).map((id) => ({ id })),
    ),
  };
  const qb: any = {
    innerJoin: () => qb,
    where: () => qb,
    andWhere: () => qb,
    getOne: async () => opts.portalMembership ?? null,
  };
  const clientUsersRepo: any = { createQueryBuilder: () => qb };
  const teamRepo: any = { find: jest.fn(async () => opts.teamRows ?? []) };
  return new ClientAccessService(clientsRepo, clientUsersRepo, teamRepo);
}

describe('ClientAccessService', () => {
  it.each(['admin', 'program_manager'])('%s sees every client', async (role) => {
    expect(await makeService({}).accessibleClientIds({ id: 1, role }, 1)).toBe('all');
  });

  it('a team member sees only the active clients they are on', async () => {
    const svc = makeService({ teamRows: [{ clientId: 10 }, { clientId: 11 }], activeClientIds: [10] });
    expect(await svc.accessibleClientIds({ id: 5, role: 'developer' }, 1)).toEqual([10]);
  });

  it('QA on a team is scoped the same way', async () => {
    const svc = makeService({ teamRows: [{ clientId: 12 }], activeClientIds: [12] });
    expect(await svc.accessibleClientIds({ id: 6, role: 'qa' }, 1)).toEqual([12]);
  });

  it.each(['developer', 'qa', 'executive', 'designer', 'devops'])('%s on no team sees nothing', async (role) => {
    expect(await makeService({}).accessibleClientIds({ id: 7, role }, 1)).toEqual([]);
  });

  it('a client user sees only their own company', async () => {
    const svc = makeService({ portalMembership: { clientId: 20 } });
    expect(await svc.accessibleClientIds({ id: 8, role: 'client' }, 1)).toEqual([20]);
  });

  it('a client user whose portal is off (or who is on no client) sees nothing', async () => {
    const svc = makeService({ portalMembership: null });
    expect(await svc.accessibleClientIds({ id: 9, role: 'client' }, 1)).toEqual([]);
  });

  it('a client user is never widened by team membership rows', async () => {
    const svc = makeService({ portalMembership: { clientId: 20 }, teamRows: [{ clientId: 21 }], activeClientIds: [21] });
    expect(await svc.accessibleClientIds({ id: 8, role: 'client' }, 1)).toEqual([20]);
  });

  it('another client is reported as not found, not forbidden', async () => {
    const svc = makeService({ portalMembership: { clientId: 20 } });
    await expect(svc.assertClientAccess({ id: 8, role: 'client' }, 1, 21)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.assertClientAccess({ id: 8, role: 'client' }, 1, 20)).resolves.toBeUndefined();
  });
});
