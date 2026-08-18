import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WeeklyReportsService } from './weekly-reports.service';

@Injectable()
export class WeeklyReportSchedulerService {
  private readonly logger = new Logger(WeeklyReportSchedulerService.name);

  constructor(private weeklyReportsService: WeeklyReportsService) {}

  // Every Monday at 8:00am (server time) - summarizes the week that just
  // ended and emails it to the configured executives, if any are set up.
  @Cron('0 8 * * 1')
  async generateWeeklyReport() {
    try {
      const report = await this.weeklyReportsService.generate(new Date());
      await this.weeklyReportsService.emailReport(report);
      this.logger.log(`Generated weekly report #${report.id} for ${report.weekStartDate} - ${report.weekEndDate}`);
    } catch (err: any) {
      this.logger.error(`Failed to generate the scheduled weekly report: ${err.message}`);
    }
  }
}
