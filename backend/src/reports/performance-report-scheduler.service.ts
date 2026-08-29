import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WeeklyReportsService } from './weekly-reports.service';
import { TenantsService } from '../tenants/tenants.service';

// Generates the richer per-assignee Weekly Performance Report (PDF +
// email) every weekend, independent of the existing Monday-morning
// executive summary job in weekly-report-scheduler.service.ts. Runs
// Saturday 8:00am server time so it covers the business week that just
// finished (Mon-Fri).
@Injectable()
export class PerformanceReportSchedulerService {
  private readonly logger = new Logger(PerformanceReportSchedulerService.name);

  constructor(
    private weeklyReportsService: WeeklyReportsService,
    private tenantsService: TenantsService,
  ) {}

  // One run per tenant - see WeeklyReportSchedulerService for why.
  @Cron('0 8 * * 6')
  async generatePerformanceReports() {
    const tenants = await this.tenantsService.findAll();
    for (const tenant of tenants) {
      try {
        const report = await this.weeklyReportsService.generate(new Date(), tenant.id);
        const { sent, skipped } = await this.weeklyReportsService.emailPerformanceReports(report);
        this.logger.log(
          `Generated weekly performance report #${report.id} for tenant #${tenant.id} (${report.weekStartDate} - ${report.weekEndDate}): ` +
            `sent to ${sent.length}, skipped ${skipped.length}.`,
        );
      } catch (err: any) {
        this.logger.error(`Failed to generate the scheduled weekly performance reports for tenant #${tenant.id}: ${err.message}`);
      }
    }
  }
}
