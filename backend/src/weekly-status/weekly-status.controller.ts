import { OWN_METRICS_REFUSAL, OwnMetricsVisibilityService } from '../performance-tracking/own-metrics-visibility.service';
import { Body, Controller, ForbiddenException, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { WeeklyStatusService } from './weekly-status.service';
import { SubmitWeeklyStatusDto, WeeklyStatusQueryDto } from './dto/weekly-status.dto';

// Performance Tracking C3 - see ./weekly-status.ts.
@Controller('weekly-status')
@UseGuards(JwtAuthGuard)
export class WeeklyStatusController {
  constructor(
    private weekly: WeeklyStatusService,
    private usersService: UsersService,
    private ownMetrics: OwnMetricsVisibilityService,
  ) {}

  // 2026-11-11 (the user): hidden from Developer/Designer/DevOps/QA - page
  // and every action - unless an Admin allows their role ("Show own
  // performance metrics to team members"). Admin/PM/Executive unchanged.
  private async me(req: any) {
    const user = (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
    if (!user || !(await this.ownMetrics.canSeeOwn(user, req.user.tenantId))) throw new ForbiddenException(OWN_METRICS_REFUSAL);
    return user;
  }

  @Get()
  async page(@Query() q: WeeklyStatusQueryDto, @Req() req: any) {
    return this.weekly.page(q.week, await this.me(req), req.user.tenantId);
  }

  @Put()
  async submit(@Body() dto: SubmitWeeklyStatusDto, @Req() req: any) {
    return this.weekly.submit(dto, await this.me(req), req.user.tenantId);
  }
}
