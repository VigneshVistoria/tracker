import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { ClientPortalService } from './client-portal.service';

// Read-only client portal endpoints (Stage 1). Who sees what is decided
// entirely by ClientAccessService - see client-access.service.ts.
@Controller('client-portal')
@UseGuards(JwtAuthGuard)
export class ClientPortalController {
  constructor(
    private portal: ClientPortalService,
    private usersService: UsersService,
  ) {}

  private async caller(req: any) {
    const user = await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId);
    if (!user) throw new UnauthorizedException();
    return { id: user.id, role: user.role };
  }

  private optionalId(value?: string): number | undefined {
    if (value === undefined || value === '') return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new BadRequestException('clientId must be a positive integer');
    return n;
  }

  @Get('clients')
  async listClients(@Req() req: any) {
    return this.portal.listClients(await this.caller(req), req.user.tenantId);
  }

  @Get('clients/:id')
  async getClient(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.portal.getClient(await this.caller(req), req.user.tenantId, id);
  }

  @Get('tickets')
  async listTickets(@Query('clientId') clientId: string | undefined, @Req() req: any) {
    return this.portal.listTickets(await this.caller(req), req.user.tenantId, this.optionalId(clientId));
  }

  @Get('tickets/:id')
  async getTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.portal.getTicket(await this.caller(req), req.user.tenantId, id);
  }

  @Get('requests')
  async listRequests(@Query('clientId') clientId: string | undefined, @Req() req: any) {
    return this.portal.listRequests(await this.caller(req), req.user.tenantId, this.optionalId(clientId));
  }

  @Get('requests/:id')
  async getRequest(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.portal.getRequest(await this.caller(req), req.user.tenantId, id);
  }
}
