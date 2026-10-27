import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserNotificationsService } from './user-notifications.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { DefectDisputeDecidedEvent, DefectDisputedEvent, DefectTriageOverdueEvent } from '../tasks/defect-triage';

// In-app notifications for defect triage (see tasks/defect-triage.ts). Same
// rules as ReturnToQaNotificationsListener: never fails the request, no
// self-notifications (the service drops those), text cut to 200 characters.
@Injectable()
export class DefectTriageNotificationsListener {
  private readonly logger = new Logger(DefectTriageNotificationsListener.name);

  constructor(
    private notifications: UserNotificationsService,
    private usersService: UsersService,
  ) {}

  private async actorName(userId: number, fallback: string, tenantId: number) {
    const actor = await this.usersService.findByIdAndTenant(userId, tenantId);
    return actor?.fullName || actor?.email || fallback;
  }

  private short(text: string | null) {
    if (!text) return null;
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
  }

  // The PMs get the decision to make (Admins when there is no PM); the QA
  // who raised it learns it is disputed.
  @OnEvent('defect.disputed')
  async onDisputed(e: DefectDisputedEvent) {
    try {
      const actorName = await this.actorName(e.actorUserId, e.actorEmail, e.tenantId);
      let pms = await this.usersService.findProgramManagers(e.tenantId);
      if (pms.length === 0) pms = await this.usersService.findByRole(UserRole.ADMIN, e.tenantId);
      const sends = pms.map((pm) =>
        this.notifications.create({
          tenantId: e.tenantId,
          userId: pm.id,
          type: 'defect.disputed',
          title: `Defect #${e.taskId} is disputed - your decision`,
          body: `${e.title} - ${e.reason}`,
          link: `/tasks/${e.taskId}#defect-triage`,
          actorUserId: e.actorUserId,
          actorName,
        }),
      );
      if (e.qaUserId && !pms.some((pm) => pm.id === e.qaUserId)) {
        sends.push(
          this.notifications.create({
            tenantId: e.tenantId,
            userId: e.qaUserId,
            type: 'defect.disputed',
            title: `The developer disputed defect #${e.taskId}`,
            body: `${e.title} - ${e.reason}. A PM will decide.`,
            link: `/tasks/${e.taskId}#defect-triage`,
            actorUserId: e.actorUserId,
            actorName,
          }),
        );
      }
      await Promise.all(sends);
    } catch (err) {
      this.logger.error(`defect.disputed notification failed: ${err}`);
    }
  }

  // The developer who disputed it and the QA who raised it hear the PM's
  // decision. (A new assignee also gets the normal "assigned" notification.)
  @OnEvent('defect.disputeDecided')
  async onDecided(e: DefectDisputeDecidedEvent) {
    try {
      const actorName = await this.actorName(e.actorUserId, e.actorEmail, e.tenantId);
      const outcome: Record<string, string> = {
        rejected: 'dispute rejected - please fix it',
        closed: 'dispute agreed - defect closed',
        reassigned: 'dispute agreed - reassigned to another developer',
        converted: `dispute agreed - converted to task #${e.convertedTaskId}`,
      };
      const comment = this.short(e.comment);
      const body = comment ? `${e.title} - ${comment}` : e.title;
      const recipients = [e.developerUserId, e.qaUserId].filter((id, i, all): id is number => !!id && all.indexOf(id) === i);
      await Promise.all(
        recipients.map((userId) =>
          this.notifications.create({
            tenantId: e.tenantId,
            userId,
            type: 'defect.disputeDecided',
            title: `Defect #${e.taskId}: ${outcome[e.decision]}`,
            body,
            link: `/tasks/${e.taskId}#defect-triage`,
            actorUserId: e.actorUserId,
            actorName,
          }),
        ),
      );
    } catch (err) {
      this.logger.error(`defect.disputeDecided notification failed: ${err}`);
    }
  }

  @OnEvent('defect.triageOverdue')
  async onOverdue(e: DefectTriageOverdueEvent) {
    try {
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.assigneeUserId,
        type: 'defect.triageOverdue',
        title: `Accept or dispute defect #${e.taskId} - triage was due ${e.dueDate}`,
        body: e.title,
        link: `/tasks/${e.taskId}#defect-triage`,
        actorName: null,
      });
    } catch (err) {
      this.logger.error(`defect.triageOverdue notification failed: ${err}`);
    }
  }
}
