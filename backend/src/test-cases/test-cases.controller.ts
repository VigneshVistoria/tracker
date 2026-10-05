import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
  Res,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { TestCasesService } from './test-cases.service';
import { CreateTestCaseDto } from './dto/create-test-case.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { CreateTestExecutionDto } from './dto/create-test-execution.dto';
import { BulkImportTestCasesDto, TestCaseSpreadsheetFormat } from './dto/bulk-import-test-cases.dto';
import { ExecutionSummaryQueryDto } from './dto/execution-summary-query.dto';
import { ApproveTestCasesDto, RejectTestCasesDto, SubmitTestCasesForReviewDto } from './dto/review-test-cases.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

const CONTENT_TYPES: Record<TestCaseSpreadsheetFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Defaults to CSV so existing links/callers without ?format keep working.
function parseFormat(format: string | undefined): TestCaseSpreadsheetFormat {
  if (format === undefined || format === 'csv') return 'csv';
  if (format === 'xlsx') return 'xlsx';
  throw new BadRequestException('format query parameter must be "csv" or "xlsx".');
}

function sendSpreadsheet(res: Response, buffer: Buffer, format: TestCaseSpreadsheetFormat, filenameStem: string) {
  res.set({
    'Content-Type': CONTENT_TYPES[format],
    'Content-Disposition': `attachment; filename="${filenameStem}.${format}"`,
  });
  res.send(buffer);
}

// Viewing the catalog (and run history) is QA + Program Manager + Admin.
// Creating, editing, bulk-importing, submitting for review and recording
// a run are also QA + Program Manager + Admin. Approving/rejecting a
// submitted test case is Program Manager only (confirmed with the user
// 2026-09-30) - Admin stays view-only on the review decision, same split
// as Tasks.
@Controller('test-cases')
@UseGuards(JwtAuthGuard)
export class TestCasesController {
  constructor(
    private testCasesService: TestCasesService,
    private usersService: UsersService,
  ) {}

  private async requireViewer(req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.QA &&
      currentUser.role !== UserRole.PROGRAM_MANAGER
    ) {
      throw new ForbiddenException('Only QA, Program Managers, and Admins can view test cases.');
    }
    return currentUser;
  }

  private async requireEditor(req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.QA &&
      currentUser.role !== UserRole.PROGRAM_MANAGER
    ) {
      throw new ForbiddenException('Only QA, Program Managers, and Admins can manage test cases.');
    }
    return currentUser;
  }

  private async requireReviewer(req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Program Managers can approve or reject test cases.');
    }
    return currentUser;
  }

  @Get()
  async findAll(@Query('projectId') projectId: string | undefined, @Req() req: any) {
    await this.requireViewer(req);
    return this.testCasesService.findAll(req.user.tenantId, projectId ? Number(projectId) : undefined);
  }

  // Read-only downloads, same "viewer" gate as the list/detail endpoints
  // above rather than requireEditor - downloading a CSV of what you can
  // already see on screen isn't a mutation. Routes are registered ahead
  // of GET ':id' below so 'bulk-export'/'bulk-import-template' are never
  // swallowed by the ':id' param route.
  @Get('bulk-export')
  async bulkExport(
    @Query('projectId') projectId: string | undefined,
    @Query('format') format: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.requireViewer(req);
    const fileFormat = parseFormat(format);
    const buffer = await this.testCasesService.bulkExport(req.user.tenantId, projectId ? Number(projectId) : undefined, fileFormat);
    sendSpreadsheet(res, buffer, fileFormat, `test-cases-${new Date().toISOString().slice(0, 10)}`);
  }

  @Get('bulk-import-template')
  async bulkImportTemplate(@Query('format') format: string | undefined, @Req() req: any, @Res() res: Response) {
    await this.requireViewer(req);
    const fileFormat = parseFormat(format);
    const buffer = await this.testCasesService.buildTemplate(req.user.tenantId, fileFormat);
    sendSpreadsheet(res, buffer, fileFormat, 'test-cases-template');
  }

  // Execution Summary for the Test Cases page - same viewer gate and the
  // same filters as the list. Registered ahead of GET ':id' for the same
  // reason as bulk-export above.
  @Get('execution-summary')
  async executionSummary(@Query() filters: ExecutionSummaryQueryDto, @Req() req: any) {
    await this.requireViewer(req);
    return this.testCasesService.executionSummary(req.user.tenantId, filters);
  }

  @Get('execution-summary/export')
  async exportExecutionSummary(@Query() filters: ExecutionSummaryQueryDto, @Req() req: any, @Res() res: Response) {
    await this.requireViewer(req);
    const buffer = await this.testCasesService.exportExecutionSummary(req.user.tenantId, filters);
    sendSpreadsheet(res, buffer, 'xlsx', `test-case-execution-summary-${new Date().toISOString().slice(0, 10)}`);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.requireViewer(req);
    return this.testCasesService.findOne(id, req.user.tenantId);
  }

  @Get(':id/executions')
  async findExecutions(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.requireViewer(req);
    return this.testCasesService.findExecutions(id, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateTestCaseDto, @Req() req: any) {
    const currentUser = await this.requireEditor(req);
    return this.testCasesService.create(dto, currentUser.id, currentUser.email, req.user.tenantId);
  }

  @Post('bulk-import')
  async bulkImport(@Body() dto: BulkImportTestCasesDto, @Req() req: any) {
    const currentUser = await this.requireEditor(req);
    return this.testCasesService.bulkImport(dto, currentUser, req.user.tenantId);
  }

  @Post('submit-for-review')
  async submitForReview(@Body() dto: SubmitTestCasesForReviewDto, @Req() req: any) {
    const currentUser = await this.requireEditor(req);
    return this.testCasesService.submitForReview(dto.ids, currentUser, req.user.tenantId);
  }

  @Post('approve')
  async approve(@Body() dto: ApproveTestCasesDto, @Req() req: any) {
    const currentUser = await this.requireReviewer(req);
    return this.testCasesService.decideReview(dto.ids, 'approve', dto.comment, currentUser, req.user.tenantId);
  }

  @Post('reject')
  async reject(@Body() dto: RejectTestCasesDto, @Req() req: any) {
    const currentUser = await this.requireReviewer(req);
    return this.testCasesService.decideReview(dto.ids, 'reject', dto.comment, currentUser, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTestCaseDto, @Req() req: any) {
    await this.requireEditor(req);
    return this.testCasesService.update(id, dto, req.user.tenantId);
  }

  @Post(':id/executions')
  async recordExecution(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTestExecutionDto,
    @Req() req: any,
  ) {
    const currentUser = await this.requireEditor(req);
    return this.testCasesService.recordExecution(id, dto, currentUser.id, currentUser.email, req.user.tenantId);
  }
}
