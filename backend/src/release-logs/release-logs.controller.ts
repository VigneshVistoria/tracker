import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { ReleaseLogsService } from './release-logs.service';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { AddReleaseItemDto } from './dto/add-release-item.dto';
import { EmailReleaseDto } from './dto/email-release.dto';
import { PdfReleaseService } from './pdf-release.service';
import { MailService } from '../mail/mail.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Program Manager only for now, view and manage alike - built PM-first
// for review (2026-09-26) before deciding what other roles get. Widen
// assertIsPm (and the page's VIEW_ROLES + the AppShell nav check)
// together when that's decided.
@Controller('releases')
@UseGuards(JwtAuthGuard)
export class ReleaseLogsController {
  constructor(
    private releaseLogsService: ReleaseLogsService,
    private usersService: UsersService,
    private pdfReleaseService: PdfReleaseService,
    private mailService: MailService,
    private auditLogService: AuditLogService,
  ) {}

  private async assertIsPm(userId: number): Promise<{ id: number; email: string }> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Program Manager can access the Release Log.');
    }
    return { id: currentUser.id, email: currentUser.email };
  }

  @Get()
  async findAll(@Query('projectId') projectId: string | undefined, @Req() req: any) {
    await this.assertIsPm(req.user.sub);
    const parsedProjectId = projectId ? Number(projectId) : undefined;
    return this.releaseLogsService.findAll(req.user.tenantId, parsedProjectId);
  }

  @Get('ticket-options')
  async ticketOptions(@Query('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.findTicketOptions(projectId, req.user.tenantId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.findOneWithItems(id, req.user.tenantId);
  }

  private pdfFilename(release: { appName: string; version: string }): string {
    const slug = `${release.appName}-${release.version}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return `release-${slug || 'log'}.pdf`;
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response, @Req() req: any) {
    await this.assertIsPm(req.user.sub);
    const release = await this.releaseLogsService.findOneWithItems(id, req.user.tenantId);
    const buffer = await this.pdfReleaseService.buildRelease(release);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${this.pdfFilename(release)}"`,
    });
    res.send(buffer);
  }

  // Same PDF as the download, sent as an attachment to the addresses the
  // PM typed in. Uses sendOrThrow so a missing SMTP config or mail
  // server error shows up in the UI instead of silently "succeeding".
  @Post(':id/email')
  async emailPdf(@Param('id', ParseIntPipe) id: number, @Body() dto: EmailReleaseDto, @Req() req: any) {
    const user = await this.assertIsPm(req.user.sub);
    const release = await this.releaseLogsService.findOneWithItems(id, req.user.tenantId);
    const recipients = [...new Set(dto.recipients.map((r) => r.trim().toLowerCase()))];
    const buffer = await this.pdfReleaseService.buildRelease(release);
    const title = `${release.appName} ${release.version}`;
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await this.mailService.sendOrThrow(
      recipients,
      `Release Log: ${title}`,
      `<p>Release Log for <strong>${escape(title)}</strong> (${escape(release.projectName)}), released ${escape(release.releaseDate)} - ${release.items.length} ticket(s).</p><p>The full log is attached as a PDF.</p><p>Sent by ${escape(user.email)} from Tracker.</p>`,
      [{ filename: this.pdfFilename(release), content: buffer, contentType: 'application/pdf' }],
    );

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.RELEASE_EMAILED,
      tenantId: req.user.tenantId,
      entityType: 'Release',
      entityId: release.id,
      details: { recipients },
    });

    return { sent: true, recipients };
  }

  @Post()
  async create(@Body() dto: CreateReleaseDto, @Req() req: any) {
    const user = await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.create(dto, user, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReleaseDto, @Req() req: any) {
    const user = await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.update(id, dto, user, req.user.tenantId);
  }

  @Post(':id/items')
  async addItem(@Param('id', ParseIntPipe) id: number, @Body() dto: AddReleaseItemDto, @Req() req: any) {
    const user = await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.addItem(id, dto.taskId, user, req.user.tenantId);
  }

  @Delete(':id/items/:itemId')
  async removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() req: any,
  ) {
    const user = await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.removeItem(id, itemId, user, req.user.tenantId);
  }
}
