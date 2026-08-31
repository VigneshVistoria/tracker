import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SlaService } from './sla.service';
import { TenantsService } from '../tenants/tenants.service';
import { Issue, IssueStatus } from '../issues/issue.entity';
import { Priority } from '../common/priority.enum';

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class SlaDueSoonSchedulerService {
  private readonly logger = new Logger(SlaDueSoonSchedulerService.name);

  constructor(
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    private slaService: SlaService,
    private tenantsService: TenantsService,
    private eventEmitter: EventEmitter2,
  ) {}

  // Every 10 minutes - scans every tenant's open Critical/Showstopper
  // issues for ones whose SLA deadline has just come within an hour, and
  // emits one issue.slaDueSoon event per newly-crossed issue (see
  // IssueNotificationsService.onSlaDueSoon for the email itself). One
  // tenant's failure shouldn't block the rest, same reasoning as
  // WeeklyReportSchedulerService's per-tenant try/catch.
  @Cron('*/10 * * * *')
  async checkDueSoon() {
    const tenants = await this.tenantsService.findAll();
    for (const tenant of tenants) {
      try {
        await this.checkDueSoonForTenant(tenant.id);
      } catch (err: any) {
        this.logger.error(`Failed to run the SLA due-soon check for tenant #${tenant.id}: ${err.message}`);
      }
    }
  }

  private async checkDueSoonForTenant(tenantId: number): Promise<void> {
    const config = await this.slaService.getConfig(tenantId);
    const candidates = await this.issuesRepository.find({
      where: [
        {
          tenantId,
          priority: Priority.CRITICAL,
          status: Not(IssueStatus.READY_FOR_PRODUCTION),
          slaDueSoonNotifiedAt: IsNull(),
        },
        {
          tenantId,
          showstopper: true,
          status: Not(IssueStatus.READY_FOR_PRODUCTION),
          slaDueSoonNotifiedAt: IsNull(),
        },
      ],
    });

    for (const issue of candidates) {
      const sla = this.slaService.computeForIssue(issue, config);
      const msRemaining = new Date(sla.dueAt).getTime() - Date.now();
      if (msRemaining <= 0 || msRemaining > HOUR_MS) continue;

      this.eventEmitter.emit('issue.slaDueSoon', { issue, dueAt: sla.dueAt, targetHours: sla.targetHours });
      issue.slaDueSoonNotifiedAt = new Date();
      await this.issuesRepository.save(issue);
    }
  }
}
