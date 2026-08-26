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
  ForbiddenException,
} from '@nestjs/common';
import { TestCasesService } from './test-cases.service';
import { CreateTestCaseDto } from './dto/create-test-case.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { CreateTestExecutionDto } from './dto/create-test-execution.dto';
import { BulkImportTestCasesDto } from './dto/bulk-import-test-cases.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Viewing the catalog (and run history) is QA + Program Manager + Admin -
// Program Manager gets read-only visibility, same relationship it has to
// QA's other gated actions (qa-approve/qa-reject) elsewhere in this app.
// Creating, bulk-importing, and recording a run are QA + Admin only.
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
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.QA) {
      throw new ForbiddenException('Only QA and Admins can manage test cases.');
    }
    return currentUser;
  }

  @Get()
  async findAll(@Query('projectId') projectId: string | undefined, @Req() req: any) {
    await this.requireViewer(req);
    return this.testCasesService.findAll(projectId ? Number(projectId) : undefined);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.requireViewer(req);
    return this.testCasesService.findOne(id);
  }

  @Get(':id/executions')
  async findExecutions(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.requireViewer(req);
    return this.testCasesService.findExecutions(id);
  }

  @Post()
  async create(@Body() dto: CreateTestCaseDto, @Req() req: any) {
    const currentUser = await this.requireEditor(req);
    return this.testCasesService.create(dto, currentUser.id, currentUser.email);
  }

  @Post('bulk-import')
  async bulkImport(@Body() dto: BulkImportTestCasesDto, @Req() req: any) {
    const currentUser = await this.requireEditor(req);
    return this.testCasesService.bulkImport(dto.csvText, currentUser.id, currentUser.email);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTestCaseDto, @Req() req: any) {
    await this.requireEditor(req);
    return this.testCasesService.update(id, dto);
  }

  @Post(':id/executions')
  async recordExecution(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTestExecutionDto,
    @Req() req: any,
  ) {
    const currentUser = await this.requireEditor(req);
    return this.testCasesService.recordExecution(id, dto, currentUser.id, currentUser.email);
  }
}
