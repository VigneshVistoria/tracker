import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { INLINE_MIME_TYPES } from '../client-portal/attachment-types';
import { RequirementsService } from './requirements.service';
import { RequirementsEditService } from './requirements-edit.service';
import { RequirementsClientService, SIGNED_DOC_MAX_BYTES, UploadedSrsFile } from './requirements-client.service';
import { RequirementsTicketsService } from './requirements-tickets.service';
import {
  ApproveAtRiskDto,
  ClientSignOffDto,
  CloseClientItemDto,
  CreateClientItemDto,
  CreateCriterionDto,
  CreateEpicDto,
  CreateStoryDto,
  LinkTicketDto,
  MapTicketsDto,
  MapTicketsQueryDto,
  MoveTicketDto,
  ReorderCriteriaDto,
  SaveCriterionResultDto,
  SaveRequirementsSettingsDto,
  UpdateClientItemDto,
  UpdateCriterionDto,
  UpdateEpicDto,
  UpdateStoryDto,
} from './dto/requirements.dto';

// The signed client document: one file, read in memory, size-capped while
// reading; type checked by content in the service.
const SIGNED_DOC_INTERCEPTOR = FileInterceptor('file', { limits: { fileSize: SIGNED_DOC_MAX_BYTES, files: 1, fields: 5 } });

// Requirements traceability - see ./requirements.ts. Roles and project
// scoping are checked in the services; with the switch OFF everything but
// /me and /settings is 404.
@Controller('requirements')
@UseGuards(JwtAuthGuard)
export class RequirementsController {
  constructor(
    private requirements: RequirementsService,
    private edit: RequirementsEditService,
    private client: RequirementsClientService,
    private tickets: RequirementsTicketsService,
    private usersService: UsersService,
  ) {}

  private async me(req: any) {
    return (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
  }

  @Get('me')
  async forMe(@Req() req: any) {
    return this.requirements.forMe(await this.me(req), req.user.tenantId);
  }

  @Get('settings')
  async settings(@Req() req: any) {
    return this.requirements.settings(await this.me(req), req.user.tenantId);
  }

  @Put('settings')
  async saveSettings(@Body() dto: SaveRequirementsSettingsDto, @Req() req: any) {
    return this.requirements.saveSettings(dto, await this.me(req), req.user.tenantId);
  }

  @Get('srs')
  async list(@Req() req: any) {
    return this.requirements.list(await this.me(req), req.user.tenantId);
  }

  @Get('srs/:id/tree')
  async tree(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.requirements.tree(id, await this.me(req), req.user.tenantId);
  }

  @Put('criteria/:id/result')
  async saveResult(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveCriterionResultDto, @Req() req: any) {
    return this.requirements.saveResult(id, dto, await this.me(req), req.user.tenantId);
  }

  // ---- Stage 2: requirements, epics, stories, criteria ----

  @Get('srs/:id/requirements')
  async requirementsList(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.edit.requirementsList(id, await this.me(req), req.user.tenantId);
  }

  @Post('srs/:id/epics')
  async createEpic(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateEpicDto, @Req() req: any) {
    return this.edit.createEpic(id, dto, await this.me(req), req.user.tenantId);
  }

  @Patch('epics/:id')
  async updateEpic(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEpicDto, @Req() req: any) {
    return this.edit.updateEpic(id, dto, await this.me(req), req.user.tenantId);
  }

  @Delete('epics/:id')
  async deleteEpic(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.edit.deleteEpic(id, await this.me(req), req.user.tenantId);
  }

  @Post('epics/:id/stories')
  async createStory(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateStoryDto, @Req() req: any) {
    return this.edit.createStory(id, dto, await this.me(req), req.user.tenantId);
  }

  @Get('stories/:id')
  async storyPage(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.edit.storyPage(id, await this.me(req), req.user.tenantId);
  }

  @Patch('stories/:id')
  async updateStory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStoryDto, @Req() req: any) {
    return this.edit.updateStory(id, dto, await this.me(req), req.user.tenantId);
  }

  @Delete('stories/:id')
  async deleteStory(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.edit.deleteStory(id, await this.me(req), req.user.tenantId);
  }

  @Post('stories/:id/approve')
  async approve(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.edit.approve(id, await this.me(req), req.user.tenantId);
  }

  @Post('stories/:id/approve-at-risk')
  async approveAtRisk(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveAtRiskDto, @Req() req: any) {
    return this.edit.approveAtRisk(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('stories/:id/criteria')
  async createCriterion(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateCriterionDto, @Req() req: any) {
    return this.edit.createCriterion(id, dto, await this.me(req), req.user.tenantId);
  }

  @Put('stories/:id/criteria/order')
  async reorderCriteria(@Param('id', ParseIntPipe) id: number, @Body() dto: ReorderCriteriaDto, @Req() req: any) {
    return this.edit.reorderCriteria(id, dto, await this.me(req), req.user.tenantId);
  }

  @Patch('criteria/:id')
  async updateCriterion(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCriterionDto, @Req() req: any) {
    return this.edit.updateCriterion(id, dto, await this.me(req), req.user.tenantId);
  }

  @Delete('criteria/:id')
  async deleteCriterion(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.edit.deleteCriterion(id, await this.me(req), req.user.tenantId);
  }

  // ---- Stage 2: client sign-off + client items ----

  @Post('srs/:id/client-sign-off')
  @UseInterceptors(SIGNED_DOC_INTERCEPTOR)
  async clientSignOff(@Param('id', ParseIntPipe) id: number, @Body() dto: ClientSignOffDto, @UploadedFile() file: UploadedSrsFile | undefined, @Req() req: any) {
    return this.client.recordClientSignOff(id, dto, file, await this.me(req), req.user.tenantId);
  }

  // Images inline, everything else downloads; nosniff and a sandbox CSP so
  // a file can never run anything (same headers as other attachments).
  @Get('srs/:id/client-sign-off/file')
  async clientSignOffFile(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Res() res: Response) {
    const file = await this.client.clientSignOffFile(id, await this.me(req), req.user.tenantId);
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

  @Get('srs/:id/client-items')
  async listClientItems(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.client.listClientItems(id, await this.me(req), req.user.tenantId);
  }

  @Post('srs/:id/client-items')
  async createClientItem(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateClientItemDto, @Req() req: any) {
    return this.client.createClientItem(id, dto, await this.me(req), req.user.tenantId);
  }

  @Patch('client-items/:id')
  async updateClientItem(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClientItemDto, @Req() req: any) {
    return this.client.updateClientItem(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('client-items/:id/close')
  async closeClientItem(@Param('id', ParseIntPipe) id: number, @Body() dto: CloseClientItemDto, @Req() req: any) {
    return this.client.closeClientItem(id, dto, await this.me(req), req.user.tenantId);
  }

  // ---- Stage 2: tickets ----

  @Get('stories/:id/ticket-lookup')
  async lookup(@Param('id', ParseIntPipe) id: number, @Query('trk') trk: string, @Req() req: any) {
    return this.tickets.lookup(id, trk, await this.me(req), req.user.tenantId);
  }

  @Post('stories/:id/tickets')
  async link(@Param('id', ParseIntPipe) id: number, @Body() dto: LinkTicketDto, @Req() req: any) {
    return this.tickets.link(id, dto, await this.me(req), req.user.tenantId);
  }

  @Delete('story-tickets/:id')
  async unlink(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.tickets.unlink(id, await this.me(req), req.user.tenantId);
  }

  @Post('story-tickets/:id/move')
  async move(@Param('id', ParseIntPipe) id: number, @Body() dto: MoveTicketDto, @Req() req: any) {
    return this.tickets.move(id, dto, await this.me(req), req.user.tenantId);
  }

  @Get('srs/:id/map/tickets')
  async mapTickets(@Param('id', ParseIntPipe) id: number, @Query() query: MapTicketsQueryDto, @Req() req: any) {
    return this.tickets.mapTickets(id, query, await this.me(req), req.user.tenantId);
  }

  @Get('srs/:id/map/suggestions')
  async suggestions(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.tickets.suggestions(id, await this.me(req), req.user.tenantId);
  }

  @Post('srs/:id/map')
  async map(@Param('id', ParseIntPipe) id: number, @Body() dto: MapTicketsDto, @Req() req: any) {
    return this.tickets.map(id, dto, await this.me(req), req.user.tenantId);
  }
}
