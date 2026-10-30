import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
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

  private async me(req: any) {
    return (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
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
