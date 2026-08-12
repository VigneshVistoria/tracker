import { Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
import { DailyUpdatesService } from './daily-updates.service';
import { CreateDailyUpdateDto } from './dto/create-daily-update.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

@Controller('daily-updates')
@UseGuards(JwtAuthGuard)
export class DailyUpdatesController {
  constructor(private dailyUpdatesService: DailyUpdatesService) {}

  @Post()
  create(@Body() dto: CreateDailyUpdateDto, @Req() req: any) {
    const { sub: userId, email } = req.user;
    return this.dailyUpdatesService.create(dto, userId, email);
  }

  // Your own submission history.
  @Get('me')
  findMine(@Req() req: any) {
    return this.dailyUpdatesService.findHistoryForUser(req.user.sub);
  }

  // Manager view: every submission, optionally filtered to one day.
  @Get()
  @UseGuards(AdminGuard)
  findAll(@Query('date') date?: string) {
    return this.dailyUpdatesService.findAll(date);
  }

  // Manager view: aggregated counts + average productivity for one day.
  @Get('team-summary')
  @UseGuards(AdminGuard)
  teamSummary(@Query('date') date?: string) {
    return this.dailyUpdatesService.teamSummary(date);
  }
}
