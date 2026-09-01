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
import { IssuesBulkService } from './issues-bulk.service';
import { BulkImportIssuesDto, BulkSpreadsheetFormat } from './dto/bulk-import-issues.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';

const CONTENT_TYPES: Record<BulkSpreadsheetFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Registered ahead of IssuesController's `:id` routes (both controllers
// share the `issues` path prefix) so `bulk-export`/`bulk-import` are
// matched as literal segments, not swallowed by the `:id` param - same
// ordering precedent already relied on for `dependencies/received` and
// `showstoppers/flagged`.
@Controller('issues')
@UseGuards(JwtAuthGuard)
export class IssuesBulkController {
  constructor(
    private issuesBulkService: IssuesBulkService,
    private usersService: UsersService,
  ) {}

  private async requireBulkAccess(req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!IssuesBulkService.isAllowedToBulkImportExport(currentUser.role)) {
      await this.issuesBulkService.recordBlockedAttempt(currentUser);
      throw new ForbiddenException('Only Administrators and Program Managers can bulk import/export issues.');
    }
    return currentUser;
  }

  @Get('bulk-export')
  async bulkExport(
    @Query('format') format: string,
    @Query('projectId') projectId: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const currentUser = await this.requireBulkAccess(req);
    if (format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('format query parameter must be "csv" or "xlsx".');
    }
    let projectIdNumber: number | undefined;
    if (projectId !== undefined) {
      projectIdNumber = Number(projectId);
      if (!Number.isInteger(projectIdNumber)) {
        throw new BadRequestException('projectId query parameter must be a whole number.');
      }
    }
    const { buffer, filename } = await this.issuesBulkService.export(
      currentUser.tenantId,
      format,
      projectIdNumber,
    );
    res.set({
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Post('bulk-import')
  async bulkImport(@Body() dto: BulkImportIssuesDto, @Req() req: any) {
    const currentUser = await this.requireBulkAccess(req);
    return this.issuesBulkService.import(dto, currentUser);
  }

  @Get('bulk-import-template')
  async bulkImportTemplate(@Query('format') format: string, @Req() req: any, @Res() res: Response) {
    await this.requireBulkAccess(req);
    if (format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('format query parameter must be "csv" or "xlsx".');
    }
    const { buffer, filename } = await this.issuesBulkService.template(format);
    res.set({
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }
}
