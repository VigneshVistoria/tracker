import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { PerformanceTrackingService } from './performance-tracking.service';
import { PERFORMANCE_TRACKING_SETTINGS_ROLES } from './performance-tracking';
import { RecalculateMetricsDto, SetPerformanceTrackingSwitchDto, UpdatePerformanceTrackingSettingsDto } from './dto/performance-tracking.dto';
import { TrackingMetricsService } from './metrics/tracking-metrics.service';
import { UserRole } from '../users/user.entity';
import { dateInZone } from '../team-settings/time-zone';
import { PerformanceMetricsService } from '../performance-metrics/performance-metrics.service';

// Performance Tracking S1 (2026-10-28): settings and the per-project
// switch only - Admin and Program Manager. The scorecard (PM, Executive and
// Admin see everyone; a developer only their own) comes in a later stage.
@Controller('performance-tracking')
@UseGuards(JwtAuthGuard)
export class PerformanceTrackingController {
  constructor(
    private readonly tracking: PerformanceTrackingService,
    private readonly usersService: UsersService,
    private readonly trackingMetrics: TrackingMetricsService,
    private readonly metrics: PerformanceMetricsService,
  ) {}

  private async editor(req: any) {
    const user = await this.usersService.findById(req.user.sub);
    if (!user || user.tenantId !== req.user.tenantId || !PERFORMANCE_TRACKING_SETTINGS_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an Admin or Program Manager can do this.');
    }
    return user;
  }

  @Get('settings')
  async settings(@Req() req: any) {
    await this.editor(req);
    return this.tracking.settingsPage(req.user.tenantId);
  }

  @Patch('settings')
  async saveSettings(@Body() dto: UpdatePerformanceTrackingSettingsDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.tracking.saveSettings(dto, user, req.user.tenantId);
  }

  @Patch('projects/:id')
  async setSwitch(@Param('id', ParseIntPipe) id: number, @Body() dto: SetPerformanceTrackingSwitchDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.tracking.setProjectSwitch(id, dto.enabled, user, req.user.tenantId);
  }

  // B2 (2026-10-30): the nightly metrics. Runs and raw rows - Admin and
  // Program Manager; "Recalculate now" - Admin only (for testing).
  @Get('runs')
  async runs(@Req() req: any) {
    await this.editor(req);
    return this.trackingMetrics.recentRuns(req.user.tenantId);
  }

  @Get('snapshots')
  async snapshots(@Query('date') date: string | undefined, @Query('projectId') projectId: string | undefined, @Req() req: any) {
    await this.editor(req);
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD.');
    const project = projectId === undefined ? undefined : Number(projectId);
    if (project !== undefined && (!Number.isInteger(project) || project <= 0)) throw new BadRequestException('projectId must be a project id.');
    return this.trackingMetrics.snapshot(req.user.tenantId, date, project);
  }

  @Post('recalculate')
  async recalculate(@Body() dto: RecalculateMetricsDto, @Req() req: any) {
    const user = await this.editor(req);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('Only an Admin can recalculate the metrics.');
    const { timeZone } = await this.metrics.getSettings(req.user.tenantId);
    const today = dateInZone(new Date(), timeZone);
    if (dto.snapshotDate && dto.snapshotDate > today) throw new BadRequestException('You cannot calculate a day that has not happened yet.');
    return this.trackingMetrics.runTenant(req.user.tenantId, { trigger: 'manual', snapshotDate: dto.snapshotDate ?? today, userId: user.id });
  }
}
