import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DEVELOPER_EQUIVALENT_ROLES, User, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { PerformanceMetricsService } from './performance-metrics.service';
import { UpdatePerformanceSettingsDto } from './dto/update-performance-settings.dto';
import { CreatePerformanceHolidayDto } from './dto/create-performance-holiday.dto';

// Role rules confirmed with the user 2026-10-27. Same inline
// look-up-the-role check as NonComplianceReportController (the JWT
// carries no role). PM, Executive and Admin see everyone; a Developer,
// Designer or DevOps sees only their own figures; everyone else gets 403.
export const ROLES_ALLOWED_TO_VIEW_ALL_METRICS: UserRole[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.PROGRAM_MANAGER];
export const ROLES_ALLOWED_TO_VIEW_OWN_METRICS: UserRole[] = DEVELOPER_EQUIVALENT_ROLES;
export const ROLES_ALLOWED_TO_EDIT_METRIC_SETTINGS: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

@Controller('performance-metrics')
@UseGuards(JwtAuthGuard)
export class PerformanceMetricsController {
  constructor(
    private readonly metricsService: PerformanceMetricsService,
    private readonly usersService: UsersService,
  ) {}

  private async requireRole(req: any, roles: UserRole[], message: string): Promise<User> {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!currentUser || currentUser.tenantId !== req.user.tenantId || !roles.includes(currentUser.role)) {
      throw new ForbiddenException(message);
    }
    return currentUser;
  }

  @Get()
  async getReport(@Query('projectId') projectId: string | undefined, @Query('to') to: string | undefined, @Req() req: any) {
    const user = await this.requireRole(
      req,
      [...ROLES_ALLOWED_TO_VIEW_ALL_METRICS, ...ROLES_ALLOWED_TO_VIEW_OWN_METRICS],
      'Performance metrics are not available for your role.',
    );
    if (to !== undefined && !DATE.test(to)) throw new BadRequestException('to must be a date like 2026-10-27.');
    return this.metricsService.computeReport(req.user.tenantId, {
      projectId: projectId ? Number(projectId) : undefined,
      to,
      onlyUserId: ROLES_ALLOWED_TO_VIEW_ALL_METRICS.includes(user.role) ? undefined : user.id,
    });
  }

  @Get('settings')
  async getSettings(@Req() req: any) {
    await this.requireRole(
      req,
      [...ROLES_ALLOWED_TO_VIEW_ALL_METRICS, ...ROLES_ALLOWED_TO_VIEW_OWN_METRICS],
      'Performance metrics are not available for your role.',
    );
    return this.metricsService.getSettings(req.user.tenantId);
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdatePerformanceSettingsDto, @Req() req: any) {
    const user = await this.requireRole(req, ROLES_ALLOWED_TO_EDIT_METRIC_SETTINGS, 'Only Admin or Program Manager can change performance metric settings.');
    return this.metricsService.updateSettings(dto, user, req.user.tenantId);
  }

  @Get('holidays')
  async listHolidays(@Req() req: any) {
    await this.requireRole(
      req,
      [...ROLES_ALLOWED_TO_VIEW_ALL_METRICS, ...ROLES_ALLOWED_TO_VIEW_OWN_METRICS],
      'Performance metrics are not available for your role.',
    );
    return this.metricsService.listHolidays(req.user.tenantId);
  }

  @Post('holidays')
  async addHoliday(@Body() dto: CreatePerformanceHolidayDto, @Req() req: any) {
    const user = await this.requireRole(req, ROLES_ALLOWED_TO_EDIT_METRIC_SETTINGS, 'Only Admin or Program Manager can change holidays.');
    return this.metricsService.addHoliday(dto, user, req.user.tenantId);
  }

  @Delete('holidays/:id')
  async removeHoliday(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.requireRole(req, ROLES_ALLOWED_TO_EDIT_METRIC_SETTINGS, 'Only Admin or Program Manager can change holidays.');
    await this.metricsService.removeHoliday(id, user, req.user.tenantId);
    return { ok: true };
  }
}
