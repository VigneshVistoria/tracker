import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req, Res, ParseIntPipe, ForbiddenException, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { TaskDependencyTicketsService } from './task-dependency-tickets.service';
import { CreateTaskDependencyTicketDto } from './dto/create-task-dependency-ticket.dto';
import { UpdateTaskDependencyTicketTitleDto } from './dto/update-task-dependency-ticket-title.dto';
import { ChangeTaskDependencyTicketOwnerDto } from './dto/change-task-dependency-ticket-owner.dto';
import { ChangeNeedByDateDto } from '../task-flags/dto/task-flags.dto';
import { SetDependencyTasksSwitchDto } from './dto/set-dependency-tasks-switch.dto';
import { DependencyTicketReasonDto } from './dto/dependency-ticket-reason.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TasksService } from '../tasks/tasks.service';
import { TaskDependencyTicketAttachmentsService } from './task-dependency-ticket-attachments.service';
import { ResolveDependencyTicketDto } from './dto/resolve-dependency-ticket.dto';
import { UploadedTaskFile } from '../tasks/task-attachments.service';
import { DEPENDENCY_ATTACHMENTS_PER_UPLOAD, DEPENDENCY_ATTACHMENT_MAX_BYTES } from './dependency-attachments';
import { INLINE_MIME_TYPES } from '../client-portal/attachment-types';

// Multipart limits enforced while reading the upload (same as the client
// portal and defect screenshots), checked again with the types in the
// service.
const DEPENDENCY_FILES_INTERCEPTOR = FilesInterceptor('files', DEPENDENCY_ATTACHMENTS_PER_UPLOAD, {
  limits: { fileSize: DEPENDENCY_ATTACHMENT_MAX_BYTES, files: DEPENDENCY_ATTACHMENTS_PER_UPLOAD, fields: 5 },
});

@Controller('task-dependency-tickets')
@UseGuards(JwtAuthGuard)
export class TaskDependencyTicketsController {
  constructor(
    private ticketsService: TaskDependencyTicketsService,
    private usersService: UsersService,
    private tasksService: TasksService,
    private attachmentsService: TaskDependencyTicketAttachmentsService,
  ) {}

  // Dependency Clearance inbox ("Outbound" on the Developer Dashboard).
  // Declared before the parentTaskId-filtered GET below purely for
  // readability - both are distinct routes ('mine' has no query param)
  // so ordering doesn't affect matching here.
  @Get('mine')
  async findMine(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.findMine(currentUser.id, req.user.tenantId);
  }

  // Developer Dashboard "Inbound" card - tickets I filed because I'm
  // blocked on someone else.
  @Get('created-by-me')
  async findCreatedByMe(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.findCreatedByMe(currentUser.id, req.user.tenantId);
  }

  // Dependency tasks per-project switch (2026-11-05) - Admin or Program
  // Manager. Declared before the ':id' routes.
  @Get('projects')
  async listProjectSwitches(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.listProjectSwitches(currentUser, req.user.tenantId);
  }

  @Patch('projects/:projectId')
  async setProjectSwitch(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: SetDependencyTasksSwitchDto,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.setProjectSwitch(projectId, dto.enabled, currentUser, req.user.tenantId);
  }

  // Dependency attachments switch (2026-11-13) - Admin or Program Manager.
  // Declared before the ':id' routes.
  @Get('attachment-switches')
  async listAttachmentSwitches(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.listAttachmentSwitches(currentUser, req.user.tenantId);
  }

  @Patch('attachment-switches/:projectId')
  async setAttachmentSwitch(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: SetDependencyTasksSwitchDto,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.setAttachmentSwitch(projectId, dto.enabled, currentUser, req.user.tenantId);
  }

  // Whether the Create Dependency Ticket form shows a file picker - same
  // view gate as the parent task.
  @Get('attachments-enabled')
  async attachmentsEnabled(@Query('parentTaskId', ParseIntPipe) parentTaskId: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(parentTaskId, req.user.tenantId);
    if (!(await this.tasksService.canView(task, currentUser))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return { enabled: await this.ticketsService.attachmentsEnabledForTask(parentTaskId, req.user.tenantId) };
  }

  // Served by the backend after the ticket's view check - no public or
  // signed links. Images inline, everything else downloads; nosniff and a
  // sandbox CSP so a file can never run anything (client portal headers).
  @Get('attachments/:attachmentId')
  async downloadAttachment(@Param('attachmentId', ParseIntPipe) attachmentId: number, @Req() req: any, @Res() res: Response) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const file = await this.attachmentsService.get(currentUser, req.user.tenantId, attachmentId);
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

  @Get(':id/attachments')
  async listAttachments(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.attachmentsService.list(currentUser, req.user.tenantId, id);
  }

  // Multipart: field "side" ('request' | 'resolution') and "files".
  @Post(':id/attachments')
  @UseInterceptors(DEPENDENCY_FILES_INTERCEPTOR)
  async addAttachments(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: UploadedTaskFile[],
    @Body('side') side: string,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.attachmentsService.add(currentUser, req.user.tenantId, id, side, files);
  }

  // Combined task detail view - dependency tickets for a given parent task.
  // Same visibility rule as the parent task itself (Assignee/creator/
  // leadership/ticket owner) so this can't be used to read another user's
  // task's dependency chatter.
  @Get()
  async findForTask(@Query('parentTaskId', ParseIntPipe) parentTaskId: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(parentTaskId, req.user.tenantId);
    if (!(await this.tasksService.canView(task, currentUser))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return this.ticketsService.findForTask(parentTaskId, req.user.tenantId);
  }

  // Task page "Dependency history" - same view gate as findForTask above.
  @Get('history')
  async findHistoryForTask(@Query('parentTaskId', ParseIntPipe) parentTaskId: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(parentTaskId, req.user.tenantId);
    if (!(await this.tasksService.canView(task, currentUser))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return this.ticketsService.findHistoryForTask(parentTaskId, req.user.tenantId);
  }

  // Dependency tasks Stage 2: one ticket (with its parent and linked task),
  // for the banner on the dependency task's page. After 'history', 'mine',
  // 'created-by-me' and 'projects' so those literal paths still match first.
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.findOneForViewer(id, currentUser, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateTaskDependencyTicketDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.create(dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/title')
  async updateTitle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskDependencyTicketTitleDto,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.updateTitle(id, dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/owner')
  async changeOwner(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeTaskDependencyTicketOwnerDto,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.changeOwner(id, dto, currentUser, req.user.tenantId);
  }

  // Performance Tracking S3 - creator or PM/Admin, with a reason.
  @Patch(':id/need-by')
  async changeNeedBy(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeNeedByDateDto,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.changeNeedBy(id, dto, currentUser, req.user.tenantId);
  }

  // JSON as before, or (attachments switch on) multipart with an optional
  // "note" and up to 5 "files".
  @Patch(':id/resolve')
  @UseInterceptors(DEPENDENCY_FILES_INTERCEPTOR)
  async resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveDependencyTicketDto,
    @UploadedFiles() files: UploadedTaskFile[],
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.resolve(id, currentUser, req.user.tenantId, { note: dto?.note ?? null, files: files ?? [] });
  }

  // Dependency tasks Stage 3: requester or Program Manager, with a reason
  // (checked in the service).
  @Patch(':id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: DependencyTicketReasonDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.cancel(id, dto.reason, currentUser, req.user.tenantId);
  }

  @Patch(':id/reopen')
  async reopen(@Param('id', ParseIntPipe) id: number, @Body() dto: DependencyTicketReasonDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.reopen(id, dto.reason, currentUser, req.user.tenantId);
  }
}
