import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KpiService } from './kpi.service';
import { TenantsService } from '../tenants/tenants.service';
import { KpiPeriodType } from './kpi-period-score.entity';

// One report per tenant, per period type - a scheduled job has no
// per-request tenant context, so each runs its own loop, same pattern as
// WeeklyReportSchedulerService.
@Injectable()
export class KpiSchedulerService {
  private readonly logger = new Logger(KpiSchedulerService.name);

  constructor(
    private kpiService: KpiService,
    private tenantsService: TenantsService,
  ) {}

  private async generateForAllTenants(periodType: KpiPeriodType) {
    const tenants = await this.tenantsService.findAll();
    for (const tenant of tenants) {
      try {
        const rows = await this.kpiService.generatePeriod(periodType, new Date(), tenant.id);
        this.logger.log(`Generated ${rows.length} ${periodType} KPI row(s) for tenant #${tenant.id}`);
      } catch (err: any) {
        this.logger.error(`Failed to generate the scheduled ${periodType} KPI period for tenant #${tenant.id}: ${err.message}`);
      }
    }
  }

  // Nightly at 1am - the day that just ended.
  @Cron('0 1 * * *')
  generateDaily() {
    return this.generateForAllTenants('daily');
  }

  // Monday 8am - same timing as the existing weekly report - the business
  // week (Mon-Fri) that just ended.
  @Cron('0 8 * * 1')
  generateWeekly() {
    return this.generateForAllTenants('weekly');
  }

  // 9am on the 1st of the month - the calendar month that just ended.
  @Cron('0 9 1 * *')
  generateMonthly() {
    return this.generateForAllTenants('monthly');
  }
}
