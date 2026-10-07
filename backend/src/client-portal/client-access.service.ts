import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Client } from './client.entity';
import { ClientUser } from './client-user.entity';
import { ClientTeamMember } from './client-team-member.entity';
import { UserRole } from '../users/user.entity';

// The one place that decides who may see which client's portal data
// (confirmed with the user 2026-10-07). Every portal read goes through
// accessibleClientIds()/assertClientAccess() - never a hand-written role
// check in a controller.
//
//   Admin, Program Manager      -> every client in their tenant
//   Client team member          -> only the clients they're on (portal
//                                  data only - their other work is untouched)
//   Client portal user          -> only their own company, and only once
//                                  that client's portal is switched on
//   Anyone else                 -> no portal data
//
// Another client's record is reported as "not found" rather than
// "forbidden", so a response never confirms that an id exists.
export const ALL_CLIENT_ROLES: string[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

export interface PortalCaller {
  id: number;
  role: string;
}

@Injectable()
export class ClientAccessService {
  constructor(
    @InjectRepository(Client) private clientsRepository: Repository<Client>,
    @InjectRepository(ClientUser) private clientUsersRepository: Repository<ClientUser>,
    @InjectRepository(ClientTeamMember) private teamMembersRepository: Repository<ClientTeamMember>,
  ) {}

  // 'all' = every client in the tenant; otherwise the exact ids allowed
  // (possibly empty).
  async accessibleClientIds(caller: PortalCaller, tenantId: number): Promise<'all' | number[]> {
    if (ALL_CLIENT_ROLES.includes(caller.role)) return 'all';
    if (caller.role === UserRole.CLIENT) {
      const membership = await this.portalMembership(caller.id, tenantId);
      return membership ? [membership.clientId] : [];
    }
    const rows = await this.teamMembersRepository.find({ where: { userId: caller.id, tenantId } });
    if (rows.length === 0) return [];
    const active = await this.clientsRepository.find({
      where: { id: In(rows.map((r) => r.clientId)), tenantId, isActive: true },
      select: ['id'],
    });
    return active.map((c) => c.id);
  }

  async canAccessClient(caller: PortalCaller, tenantId: number, clientId: number): Promise<boolean> {
    const ids = await this.accessibleClientIds(caller, tenantId);
    if (ids === 'all') return true;
    return ids.includes(clientId);
  }

  async assertClientAccess(caller: PortalCaller, tenantId: number, clientId: number): Promise<void> {
    if (!(await this.canAccessClient(caller, tenantId, clientId))) {
      throw new NotFoundException('Not found');
    }
  }

  // A client user whose client has the portal switched on. These users
  // are kept away from internal endpoints and the tenant-wide live
  // updates (BlockPortalClientsGuard, EventsGateway). While a client's
  // portalEnabled is false this is false for all its users, so nothing
  // changes for them.
  async isPortalClientUser(userId: number, tenantId: number): Promise<boolean> {
    return Boolean(await this.portalMembership(userId, tenantId));
  }

  // The switched-on client this user belongs to, or null.
  async portalClientIdFor(userId: number, tenantId: number): Promise<number | null> {
    return (await this.portalMembership(userId, tenantId))?.clientId ?? null;
  }

  private async portalMembership(userId: number, tenantId: number): Promise<ClientUser | null> {
    return this.clientUsersRepository
      .createQueryBuilder('cu')
      .innerJoin(Client, 'c', 'c.id = cu."clientId" AND c."tenantId" = cu."tenantId"')
      .where('cu."userId" = :userId', { userId })
      .andWhere('cu."tenantId" = :tenantId', { tenantId })
      .andWhere('c."portalEnabled" = true AND c."isActive" = true')
      .getOne();
  }
}
