import { Controller, Delete, Get, Param, ParseIntPipe, Post, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TaskAttachmentsService, UploadedTaskFile } from './task-attachments.service';
import { QaReviewAttachmentsService } from './qa-review-attachments.service';
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BYTES } from '../client-portal/attachment-types';

// Defect screenshots - see TaskAttachmentsService. Registered before
// TasksController in TasksModule; every route here is two segments, so
// none can collide with its ':id' routes anyway.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TaskAttachmentsController {
  constructor(
    private attachments: TaskAttachmentsService,
    private qaReviewAttachments: QaReviewAttachmentsService,
    private usersService: UsersService,
  ) {}

  // Same headers for every image this controller serves: inline, nosniff,
  // and a CSP so a file can never run anything.
  private sendImage(res: Response, file: { fileName: string; mimeType: string; data: Buffer }) {
    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.data.length),
      'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.send(file.data);
  }

  // Multipart upload, field "files". Limits are enforced while reading the
  // upload (same as the client portal), then checked again with the file
  // types in the service.
  @Post(':id/attachments')
  @UseInterceptors(
    FilesInterceptor('files', MAX_ATTACHMENTS_PER_UPLOAD, {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS_PER_UPLOAD, fields: 5 },
    }),
  )
  async add(@Param('id', ParseIntPipe) id: number, @UploadedFiles() files: UploadedTaskFile[], @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.attachments.add(currentUser, req.user.tenantId, id, files);
  }

  @Get(':id/attachments')
  async list(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.attachments.list(currentUser, req.user.tenantId, id);
  }

  @Delete(':id/attachments/:attachmentId')
  async remove(@Param('id', ParseIntPipe) id: number, @Param('attachmentId', ParseIntPipe) attachmentId: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.attachments.remove(currentUser, req.user.tenantId, id, attachmentId);
  }

  // Served by the backend after the view check - no public or signed
  // links. Images only, shown inline; the CSP stops a file from ever
  // running anything (same headers as client portal downloads).
  @Get('attachments/:attachmentId')
  async download(@Param('attachmentId', ParseIntPipe) attachmentId: number, @Req() req: any, @Res() res: Response) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const file = await this.attachments.get(currentUser, req.user.tenantId, attachmentId);
    this.sendImage(res, file);
  }

  // Screenshots on a QA decision (approve/reject/escalate) - uploaded to
  // the round right after the decision; see QaReviewAttachmentsService.
  @Post(':id/qa-reviews/:reviewId/attachments')
  @UseInterceptors(
    FilesInterceptor('files', MAX_ATTACHMENTS_PER_UPLOAD, {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS_PER_UPLOAD, fields: 5 },
    }),
  )
  async addToDecision(
    @Param('id', ParseIntPipe) id: number,
    @Param('reviewId', ParseIntPipe) reviewId: number,
    @UploadedFiles() files: UploadedTaskFile[],
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.qaReviewAttachments.add(currentUser, req.user.tenantId, id, reviewId, files);
  }

  @Get(':id/qa-review-attachments')
  async listDecisionScreenshots(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.qaReviewAttachments.list(currentUser, req.user.tenantId, id);
  }

  @Get('qa-review-attachments/:attachmentId')
  async downloadDecisionScreenshot(@Param('attachmentId', ParseIntPipe) attachmentId: number, @Req() req: any, @Res() res: Response) {
    const currentUser = await this.usersService.findById(req.user.sub);
    this.sendImage(res, await this.qaReviewAttachments.get(currentUser, req.user.tenantId, attachmentId));
  }
}
