import { Controller, Get, Query, UseGuards, Req, Res, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import { NonComplianceReportService } from './non-compliance-report.service';
import { PdfNonComplianceReportService } from './pdf-non-compliance-report.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Admin/Executive/Program Manager only, same manual role-check pattern
// and same tier as KpiController.findReport() - a developer never sees
// this report about themselves or teammates (confirmed with the user).
const ROLES_ALLOWED_TO_VIEW: UserRole[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.PROGRAM_MANAGER];

@Controller('non-compliance-report')
@UseGuards(JwtAuthGuard)
export class NonComplianceReportController {
  constructor(
    private reportService: NonComplianceReportService,
    private pdfService: PdfNonComplianceReportService,
    private usersService: UsersService,
  ) {}

  @Get()
  async findReport(
    @Query('projectId') projectId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW.includes(currentUser.role)) {
      throw new ForbiddenException('Only Admins, Program Managers, and Executives can view the Non-Compliance Report.');
    }
    return this.reportService.computeReport(req.user.tenantId, projectId ? Number(projectId) : undefined, from, to);
  }

  // On-demand PDF download of the exact same report - no email side
  // effect, no cron schedule (this is an ad hoc investigation report, not
  // a recurring digest) - same "manual download, no mass-send" shape as
  // WeeklyReportsController.downloadPerformancePdf().
  @Get('pdf')
  async downloadPdf(
    @Query('projectId') projectId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW.includes(currentUser.role)) {
      throw new ForbiddenException('Only Admins, Program Managers, and Executives can view the Non-Compliance Report.');
    }
    const report = await this.reportService.computeReport(req.user.tenantId, projectId ? Number(projectId) : undefined, from, to);
    const buffer = await this.pdfService.buildReport(report);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="developer-non-compliance-report.pdf"',
    });
    res.send(buffer);
  }
}
