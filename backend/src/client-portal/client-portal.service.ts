import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Client } from './client.entity';
import { ClientTeamMember } from './client-team-member.entity';
import { ClientRequest } from './client-request.entity';
import { ALL_CLIENT_ROLES, ClientAccessService, PortalCaller } from './client-access.service';
import { ProjectModule } from '../modules/project-module.entity';
import { User, UserRole } from '../users/user.entity';

// Read side of the client portal (Stage 1). Every method scopes through
// ClientAccessService first; a record outside the caller's clients is
// "not found". Tickets live in ClientTicketsService.
@Injectable()
export class ClientPortalService {
  constructor(
    @InjectRepository(Client) private clientsRepository: Repository<Client>,
    @InjectRepository(ClientTeamMember) private teamMembersRepository: Repository<ClientTeamMember>,
    @InjectRepository(ClientRequest) private requestsRepository: Repository<ClientRequest>,
    @InjectRepository(ProjectModule) private modulesRepository: Repository<ProjectModule>,
    @InjectRepository(User) private usersRepository: Repository<User>,
    private access: ClientAccessService,
  ) {}

  // `where` fragment limiting a query to the caller's clients, or null
  // when they have none (callers return an empty list).
  private async clientScope(caller: PortalCaller, tenantId: number): Promise<Record<string, any> | null> {
    const ids = await this.access.accessibleClientIds(caller, tenantId);
    if (ids === 'all') return { tenantId };
    if (ids.length === 0) return null;
    return { tenantId, clientId: In(ids) };
  }

  // What the frontend needs for routing and navigation (Stage 2):
  //   portalClient - the caller's switched-on company (client users only);
  //                  they always land on /portal
  //   teamClients  - clients whose tickets the caller works (staff), which
  //                  shows the "Client tickets" link
  async me(caller: PortalCaller, tenantId: number) {
    if (caller.role === UserRole.CLIENT) {
      const clientId = await this.access.portalClientIdFor(caller.id, tenantId);
      if (!clientId) return { portalClient: null, teamClients: [], canSeeClientTickets: false };
      const client = await this.getClient(caller, tenantId, clientId);
      return {
        portalClient: { id: client.id, name: client.name, ticketPrefix: client.ticketPrefix, modules: client.modules },
        teamClients: [],
        canSeeClientTickets: false,
      };
    }
    const teamClients = (await this.listClients(caller, tenantId)).filter((c) => c.isActive);
    return {
      portalClient: null,
      teamClients: teamClients.map((c) => ({ id: c.id, name: c.name, portalEnabled: c.portalEnabled })),
      canSeeClientTickets: ALL_CLIENT_ROLES.includes(caller.role) || teamClients.length > 0,
    };
  }

  async listClients(caller: PortalCaller, tenantId: number) {
    const ids = await this.access.accessibleClientIds(caller, tenantId);
    if (ids !== 'all' && ids.length === 0) return [];
    const clients = await this.clientsRepository.find({
      where: ids === 'all' ? { tenantId } : { tenantId, id: In(ids) },
      order: { name: 'ASC' },
    });
    return clients.map((c) => this.toClientSummary(c));
  }

  // The client, its team (names and team roles; emails only for staff
  // callers) and its project's active modules.
  async getClient(caller: PortalCaller, tenantId: number, clientId: number) {
    await this.access.assertClientAccess(caller, tenantId, clientId);
    const client = await this.clientsRepository.findOne({ where: { id: clientId, tenantId } });
    if (!client) throw new NotFoundException('Not found');
    const members = await this.teamMembersRepository.find({ where: { clientId, tenantId }, order: { id: 'ASC' } });
    const users = members.length
      ? await this.usersRepository.find({ where: { id: In(members.map((m) => m.userId)), tenantId } })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const isClientCaller = caller.role === UserRole.CLIENT;
    const modules = await this.modulesRepository.find({
      where: { projectId: client.projectId, tenantId, isActive: true },
      order: { name: 'ASC' },
    });
    return {
      ...this.toClientSummary(client),
      team: members.map((m) => ({
        userId: m.userId,
        name: userById.get(m.userId)?.fullName || null,
        ...(isClientCaller ? {} : { email: userById.get(m.userId)?.email || null }),
        teamRole: m.teamRole,
        getsNewTickets: m.getsNewTickets,
        ccAll: m.ccAll,
      })),
      modules: modules.map((m) => ({ id: m.id, name: m.name })),
    };
  }

  async listRequests(caller: PortalCaller, tenantId: number, clientId?: number) {
    const scope = await this.clientScope(caller, tenantId);
    if (!scope) return [];
    if (clientId !== undefined) {
      if (!(await this.access.canAccessClient(caller, tenantId, clientId))) return [];
      scope.clientId = clientId;
    }
    return this.requestsRepository.find({ where: scope, order: { createdAt: 'DESC', id: 'DESC' } });
  }

  async getRequest(caller: PortalCaller, tenantId: number, id: number) {
    const request = await this.requestsRepository.findOne({ where: { id, tenantId } });
    if (!request || !(await this.access.canAccessClient(caller, tenantId, request.clientId))) {
      throw new NotFoundException('Not found');
    }
    return request;
  }

  private toClientSummary(c: Client) {
    return { id: c.id, name: c.name, ticketPrefix: c.ticketPrefix, projectId: c.projectId, keyContactUserId: c.keyContactUserId, portalEnabled: c.portalEnabled, isActive: c.isActive };
  }
}
