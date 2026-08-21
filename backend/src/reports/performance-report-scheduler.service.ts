import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WeeklyReportsService } from './weekly-reports.service';

// Generates the richer per-assignee Weekly Performance Report (PDF +
// email) every weekend, independent of the existing Monday-morning
// executive summary job in weekly-report-scheduler.service.ts. Runs
// Saturday 8:00am server time so it covers the business week that just
// finished (Mon-Fri).
@Injectable()
export class PerformanceReportSchedulerService {
  private readonly logger = new Logger(PerformanceReportSchedulerService.name);

  constructor(private weeklyReportsService: WeeklyReportsService) {}

  @Cron('0 8 * * 6')
  async generatePerformanceReports() {
    try {
      const report = await this.weeklyReportsService.generate(new Date());
      const { sent, skipped } = await this.weeklyReportsService.emailPerformanceReports(report);
      this.logger.log(
        `Generated weekly performance report #${report.id} for ${report.weekStartDate} - ${report.weekEndDate}: ` +
          `sent to ${sent.length}, skipped ${skipped.length}.`,
      );
    } catch (err: any) {
      this.logger.error(`Failed to generate the scheduled weekly performance reports: ${err.message}`);
    }
  }
}
