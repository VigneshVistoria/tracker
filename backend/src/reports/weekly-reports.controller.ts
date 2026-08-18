import { Controller, Get, Post, Param, ParseIntPipe, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { WeeklyReportsService } from './weekly-reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Viewing reports is open to Admin and Executive (read-only, per the
// Executive role's purpose). Generating a new one is admin-only, since it
// also emails executives - a manual trigger for that shouldn't be
// self-service for the very people receiving it.
@Controller('reports/weekly')
@UseGuards(JwtAuthGuard)
export class WeeklyReportsController {
  constructor(
    private weeklyReportsService: WeeklyReportsService,
    private usersService: UsersService,
  ) {}

  @Post('generate')
  @UseGuards(AdminGuard)
  async generate(@Req() req: any) {
    const report = await this.weeklyReportsService.generate(new Date(), req.user.sub);
    await this.weeklyReportsService.emailReport(report);
    return report;
  }

  @Get('history')
  async findHistory(@Req() req: any) {
    await this.assertCanView(req);
    return this.weeklyReportsService.findHistory();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanView(req);
    return this.weeklyReportsService.findOne(id);
  }

  private async assertCanView(req: any): Promise<void> {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.EXECUTIVE) {
      throw new ForbiddenException('Weekly reports are only available to Admins and Executives.');
    }
  }
}
