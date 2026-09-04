import { Controller, Get, Post, Body, Query, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { GenerateKpiPeriodDto } from './dto/generate-kpi-period.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { KpiPeriodType } from './kpi-period-score.entity';

@Controller('kpi')
@UseGuards(JwtAuthGuard)
export class KpiController {
  constructor(
    private kpiService: KpiService,
    private usersService: UsersService,
  ) {}

  // Own-score view. assigneeUserId is ALWAYS req.user.sub - never accepted
  // as a query param - and this never computes or returns any
  // cross-assignee aggregate (no team average, no rank). This is the
  // actual access-control boundary, not a hidden UI element - see
  // KpiService.findMine()'s own comment.
  @Get('me')
  findMine(
    @Query('periodType') periodType: KpiPeriodType | undefined,
    @Query('projectId') projectId: string | undefined,
    @Req() req: any,
  ) {
    return this.kpiService.findMine(req.user.tenantId, req.user.sub, periodType, projectId ? Number(projectId) : undefined);
  }

  // Full breakdown across assignees - Admin/Executive/Program Manager
  // only, same manual role-check pattern as
  // TimeSheetsController.getReport().
  @Get('report')
  async findReport(
    @Query('periodType') periodType: KpiPeriodType | undefined,
    @Query('projectId') projectId: string | undefined,
    @Query('assigneeUserId') assigneeUserId: string | undefined,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.EXECUTIVE && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Admins, Program Managers, and Executives can view the KPI report.');
    }
    return this.kpiService.findReport(
      req.user.tenantId,
      periodType,
      projectId ? Number(projectId) : undefined,
      assigneeUserId ? Number(assigneeUserId) : undefined,
    );
  }

  // Manual generate-now, for testing/backfill - Admin/Program Manager
  // only, same shape as POST /reports/weekly/generate.
  @Post('generate')
  async generate(@Body() dto: GenerateKpiPeriodDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Admins and Program Managers can manually generate a KPI period.');
    }
    return this.kpiService.generatePeriod(dto.periodType, new Date(dto.referenceDate), req.user.tenantId, currentUser.id);
  }
}
