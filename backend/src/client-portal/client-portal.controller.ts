import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { ClientPortalService } from './client-portal.service';
import { ClientTicketsService } from './client-tickets.service';
import { CreateClientTicketCommentDto, CreateClientTicketDto, UpdateClientTicketDto } from './dto/client-ticket.dto';

// Client portal endpoints. Who sees what is decided entirely by
// ClientAccessService - see client-access.service.ts.
@Controller('client-portal')
@UseGuards(JwtAuthGuard)
export class ClientPortalController {
  constructor(
    private portal: ClientPortalService,
    private tickets: ClientTicketsService,
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

  @Get('me')
  async me(@Req() req: any) {
    return this.portal.me(await this.caller(req), req.user.tenantId);
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
    return this.tickets.list(await this.caller(req), req.user.tenantId, this.optionalId(clientId));
  }

  @Post('tickets')
  async createTicket(@Body() dto: CreateClientTicketDto, @Req() req: any) {
    return this.tickets.create(await this.caller(req), req.user.tenantId, dto);
  }

  @Get('tickets/:id')
  async getTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.tickets.get(await this.caller(req), req.user.tenantId, id);
  }

  @Patch('tickets/:id')
  async updateTicket(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClientTicketDto, @Req() req: any) {
    return this.tickets.update(await this.caller(req), req.user.tenantId, id, dto);
  }

  @Post('tickets/:id/comments')
  async addComment(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateClientTicketCommentDto, @Req() req: any) {
    return this.tickets.addComment(await this.caller(req), req.user.tenantId, id, dto);
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
