import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { PerformanceTrackingService } from './performance-tracking.service';
import { PERFORMANCE_TRACKING_SETTINGS_ROLES } from './performance-tracking';
import { SetPerformanceTrackingSwitchDto, UpdatePerformanceTrackingSettingsDto } from './dto/performance-tracking.dto';

// Performance Tracking S1 (2026-10-28): settings and the per-project
// switch only - Admin and Program Manager. The scorecard (PM, Executive and
// Admin see everyone; a developer only their own) comes in a later stage.
@Controller('performance-tracking')
@UseGuards(JwtAuthGuard)
export class PerformanceTrackingController {
  constructor(
    private readonly tracking: PerformanceTrackingService,
    private readonly usersService: UsersService,
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
}
