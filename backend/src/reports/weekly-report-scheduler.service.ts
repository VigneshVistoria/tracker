import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WeeklyReportsService } from './weekly-reports.service';
import { TenantsService } from '../tenants/tenants.service';

@Injectable()
export class WeeklyReportSchedulerService {
  private readonly logger = new Logger(WeeklyReportSchedulerService.name);

  constructor(
    private weeklyReportsService: WeeklyReportsService,
    private tenantsService: TenantsService,
  ) {}

  // Every Monday at 8:00am (server time) - summarizes the week that just
  // ended and emails it to the configured executives, if any are set up.
  // One report per tenant - a scheduled job has no per-request tenant
  // context, so it runs its own loop instead.
  @Cron('0 8 * * 1')
  async generateWeeklyReport() {
    const tenants = await this.tenantsService.findAll();
    for (const tenant of tenants) {
      try {
        const report = await this.weeklyReportsService.generate(new Date(), tenant.id);
        await this.weeklyReportsService.emailReport(report);
        this.logger.log(`Generated weekly report #${report.id} for tenant #${tenant.id} (${report.weekStartDate} - ${report.weekEndDate})`);
      } catch (err: any) {
        this.logger.error(`Failed to generate the scheduled weekly report for tenant #${tenant.id}: ${err.message}`);
      }
    }
  }
}
