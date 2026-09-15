import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { TasksBulkService } from './tasks-bulk.service';
import { BulkImportTasksDto, BulkSpreadsheetFormat } from './dto/bulk-import-tasks.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';

const CONTENT_TYPES: Record<BulkSpreadsheetFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Registered ahead of TasksController's `:id` routes (both controllers
// share the `tasks` path prefix) so `bulk-export`/`bulk-import`/
// `bulk-import-template` are matched as literal segments, not swallowed
// by the `:id` param - same ordering precedent as IssuesBulkController.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksBulkController {
  constructor(
    private tasksBulkService: TasksBulkService,
    private usersService: UsersService,
  ) {}

  private async requireBulkExportAccess(req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!TasksBulkService.isAllowedToBulkExport(currentUser.role)) {
      await this.tasksBulkService.recordBlockedAttempt(currentUser);
      throw new ForbiddenException('Only Admin and Program Manager can bulk export the Task Backlog.');
    }
    return currentUser;
  }

  private async requireBulkImportAccess(req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!TasksBulkService.isAllowedToBulkImport(currentUser.role)) {
      await this.tasksBulkService.recordBlockedAttempt(currentUser);
      throw new ForbiddenException('Only Program Manager can bulk import Task Backlog tasks.');
    }
    return currentUser;
  }

  @Get('bulk-export')
  async bulkExport(@Query('format') format: string, @Req() req: any, @Res() res: Response) {
    const currentUser = await this.requireBulkExportAccess(req);
    if (format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('format query parameter must be "csv" or "xlsx".');
    }
    const { buffer, filename } = await this.tasksBulkService.export(currentUser.tenantId, format);
    res.set({
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Post('bulk-import')
  async bulkImport(@Body() dto: BulkImportTasksDto, @Req() req: any) {
    const currentUser = await this.requireBulkImportAccess(req);
    return this.tasksBulkService.import(dto, currentUser);
  }

  // Template download is gated the same as export (read-only) rather
  // than import - Admin can already see the Backlog and its expected
  // columns are the same regardless of who ends up importing.
  @Get('bulk-import-template')
  async bulkImportTemplate(@Query('format') format: string, @Req() req: any, @Res() res: Response) {
    await this.requireBulkExportAccess(req);
    if (format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('format query parameter must be "csv" or "xlsx".');
    }
    const { buffer, filename } = await this.tasksBulkService.template(format);
    res.set({
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }
}
