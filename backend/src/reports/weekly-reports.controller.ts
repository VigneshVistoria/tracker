import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  Res,
  Query,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
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

  // Manual trigger for the per-assignee PDF performance reports, so this
  // can be tested/run on demand instead of waiting for the Saturday
  // scheduled job. Admin-only, same rationale as generate() above.
  @Post('generate-performance')
  @UseGuards(AdminGuard)
  async generatePerformanceReports(@Req() req: any) {
    const report = await this.weeklyReportsService.generate(new Date(), req.user.sub);
    const result = await this.weeklyReportsService.emailPerformanceReports(report);
    return { report, ...result };
  }

  // Admin-only manual download of one assignee's performance PDF, with no
  // email side effect - lets an admin preview/review a report (or grab it
  // for a manual send) without triggering the mass-email that
  // generate-performance causes for every assignee.
  @Get('performance-pdf')
  @UseGuards(AdminGuard)
  async downloadPerformancePdf(
    @Query('assigneeEmail') assigneeEmail: string,
    @Res() res: Response,
  ) {
    if (!assigneeEmail) {
      throw new BadRequestException('assigneeEmail query parameter is required');
    }
    const report = await this.weeklyReportsService.generate(new Date());
    const result = await this.weeklyReportsService.buildPerformancePdfBuffer(report, assigneeEmail);
    if (!result) {
      throw new NotFoundException(`No report data found for assignee ${assigneeEmail}`);
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    });
    res.send(result.buffer);
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
