import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserNotificationsService } from './user-notifications.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { DueDateChangeDecidedEvent, DueDateChangeRequestedEvent, DueDateChangedDirectEvent } from '../tasks/due-date-change';
import { formatLongDate } from '../tasks/team-export/team-tasks-export';

// In-app notifications for Due date change requests (Performance Tracking
// S2, see tasks/due-date-change.ts). Same rules as the other listeners:
// never fails the request, no self-notifications (the service drops
// those), reasons cut to 200 characters.
@Injectable()
export class DueDateChangeNotificationsListener {
  private readonly logger = new Logger(DueDateChangeNotificationsListener.name);

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

  // Every Program Manager and Admin can decide, so all of them hear.
  @OnEvent('task.dueDateChangeRequested')
  async onRequested(e: DueDateChangeRequestedEvent) {
    try {
      const actorName = await this.actorName(e.requesterUserId, e.requesterEmail, e.tenantId);
      const [pms, admins] = await Promise.all([
        this.usersService.findByRole(UserRole.PROGRAM_MANAGER, e.tenantId),
        this.usersService.findByRole(UserRole.ADMIN, e.tenantId),
      ]);
      await Promise.all(
        [...pms, ...admins].map((u) =>
          this.notifications.create({
            tenantId: e.tenantId,
            userId: u.id,
            type: 'task.dueDateChangeRequested',
            title: `${actorName} asks to move #${e.taskId} to ${formatLongDate(e.requestedDueDate)}`,
            body: `${e.title} - now due ${formatLongDate(e.currentDueDate)}. ${this.short(e.reason)}`,
            link: `/tasks/${e.taskId}#due-date`,
            actorUserId: e.requesterUserId,
            actorName,
          }),
        ),
      );
    } catch (err) {
      this.logger.error(`task.dueDateChangeRequested notification failed: ${err}`);
    }
  }

  @OnEvent('task.dueDateChangeDecided')
  async onDecided(e: DueDateChangeDecidedEvent) {
    try {
      const actorName = await this.actorName(e.actorUserId, e.actorEmail, e.tenantId);
      const note = this.short(e.note);
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.requesterUserId,
        type: 'task.dueDateChangeDecided',
        title:
          e.decision === 'approved'
            ? `New Due date approved for #${e.taskId}: ${formatLongDate(e.requestedDueDate)}`
            : `Due date change for #${e.taskId} was not approved`,
        body: note ? `${e.title} - ${note}` : e.title,
        link: `/tasks/${e.taskId}#due-date`,
        actorUserId: e.actorUserId,
        actorName,
      });
    } catch (err) {
      this.logger.error(`task.dueDateChangeDecided notification failed: ${err}`);
    }
  }

  @OnEvent('task.dueDateChangedDirect')
  async onDirect(e: DueDateChangedDirectEvent) {
    try {
      if (!e.assigneeUserId) return;
      const actorName = await this.actorName(e.actorUserId, e.actorEmail, e.tenantId);
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.assigneeUserId,
        type: 'task.dueDateChangedDirect',
        title: `${actorName} moved the Due date of #${e.taskId} to ${formatLongDate(e.newDueDate)}`,
        body: `${e.title} - was ${formatLongDate(e.oldDueDate)}. ${this.short(e.reason)}`,
        link: `/tasks/${e.taskId}#due-date`,
        actorUserId: e.actorUserId,
        actorName,
      });
    } catch (err) {
      this.logger.error(`task.dueDateChangedDirect notification failed: ${err}`);
    }
  }
}
