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

  // referenceDate must fall inside the period that just ended - passing
  // new Date() here scored the period that was only just starting (e.g.
  // the 1am daily job scored the new day, with nothing completed yet).
  private async generateForAllTenants(periodType: KpiPeriodType, referenceDate: Date) {
    const tenants = await this.tenantsService.findAll();
    for (const tenant of tenants) {
      try {
        const rows = await this.kpiService.generatePeriod(periodType, referenceDate, tenant.id);
        this.logger.log(`Generated ${rows.length} ${periodType} KPI row(s) for tenant #${tenant.id}`);
      } catch (err: any) {
        this.logger.error(`Failed to generate the scheduled ${periodType} KPI period for tenant #${tenant.id}: ${err.message}`);
      }
    }
  }

  private daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  // Nightly at 1am - the day that just ended.
  @Cron('0 1 * * *')
  generateDaily() {
    return this.generateForAllTenants('daily', this.daysAgo(1));
  }

  // Monday 8am - same timing as the existing weekly report - the business
  // week (Mon-Fri) that just ended.
  @Cron('0 8 * * 1')
  generateWeekly() {
    return this.generateForAllTenants('weekly', this.daysAgo(7));
  }

  // 9am on the 1st of the month - the calendar month that just ended.
  @Cron('0 9 1 * *')
  generateMonthly() {
    return this.generateForAllTenants('monthly', this.daysAgo(1));
  }
}
