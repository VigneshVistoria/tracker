import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserNotificationsService } from './user-notifications.service';
import { UsersService } from '../users/users.service';
import { SecurityFindingEvent } from '../security-findings/security-findings';
import { formatLongDate } from '../tasks/team-export/team-tasks-export';

// In-app notifications for security findings (Performance Tracking P3/P4,
// see security-findings/security-findings.ts): the owner is told of a new
// finding (or one moved to them) and of a failed verification. In-app
// only, never fails the request, no self-notifications.
@Injectable()
export class SecurityFindingsNotificationsListener {
  private readonly logger = new Logger(SecurityFindingsNotificationsListener.name);

  constructor(
    private notifications: UserNotificationsService,
    private usersService: UsersService,
  ) {}

  @OnEvent('security.finding')
  async onFinding(e: SecurityFindingEvent) {
    try {
      const actor = await this.usersService.findByIdAndTenant(e.actorUserId, e.tenantId);
      const actorName = actor?.fullName || actor?.email || e.actorEmail;
      const severity = e.severity[0].toUpperCase() + e.severity.slice(1);
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.ownerUserId,
        type: e.kind === 'created' ? 'security.findingAssigned' : 'security.fixFailed',
        title: e.kind === 'created' ? `${severity} security finding for you: fix by ${formatLongDate(e.dueOn)}` : `${actorName} found your security fix did not work`,
        body: e.title,
        link: `/performance-tracking/security-findings#finding-${e.findingId}`,
        actorUserId: e.actorUserId,
        actorName,
      });
    } catch (err) {
      this.logger.error(`security.finding notification failed: ${err}`);
    }
  }
}
