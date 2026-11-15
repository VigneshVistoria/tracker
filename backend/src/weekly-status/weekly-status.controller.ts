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
  ) {}

  // 2026-11-11 this was behind the "own performance metrics" setting; 2026-11-15
  // (the user) the report is a work item, not a figure, so filing is open
  // again - the service decides who files (Developer/Designer/DevOps/QA) and
  // who sees the team (Admin/PM/Executive).
  private async me(req: any) {
    const user = await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId);
    if (!user) throw new ForbiddenException('You cannot see weekly status reports.');
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
