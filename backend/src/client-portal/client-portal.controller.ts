import {
  Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors,
  BadRequestException, UnauthorizedException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { ClientPortalService } from './client-portal.service';
import { ClientTicketsService, UploadedPortalFile } from './client-tickets.service';
import { INLINE_MIME_TYPES, MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BYTES } from './attachment-types';
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

  private optionalId(value?: string, field = 'clientId'): number | undefined {
    if (value === undefined || value === '') return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new BadRequestException(`${field} must be a positive integer`);
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

  // Multipart upload, field "files" (Stage 3). Limits are enforced while
  // reading the upload, then checked again with the file types in the
  // service. Optional "commentId" attaches the files to the caller's own
  // reply (and makes them team-only if that reply is an internal note).
  @Post('tickets/:id/attachments')
  @UseInterceptors(
    FilesInterceptor('files', MAX_ATTACHMENTS_PER_UPLOAD, {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS_PER_UPLOAD, fields: 5 },
    }),
  )
  async addAttachments(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: UploadedPortalFile[],
    @Body('commentId') commentId: string | undefined,
    @Req() req: any,
  ) {
    return this.tickets.addAttachments(await this.caller(req), req.user.tenantId, id, files, this.optionalId(commentId, 'commentId'));
  }

  // Served by the backend after the access check - there are no public or
  // signed links. Images show inline; everything else downloads, and the
  // CSP stops a file from ever running anything.
  @Get('attachments/:id')
  async downloadAttachment(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Res() res: Response) {
    const file = await this.tickets.getAttachment(await this.caller(req), req.user.tenantId, id);
    const disposition = INLINE_MIME_TYPES.includes(file.mimeType) ? 'inline' : 'attachment';
    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.data.length),
      'Content-Disposition': `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.send(file.data);
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
