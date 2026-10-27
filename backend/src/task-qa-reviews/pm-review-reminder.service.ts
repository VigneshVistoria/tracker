import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, IsNull, Repository } from 'typeorm';
import { TaskQaReview } from './task-qa-review.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TenantsService } from '../tenants/tenants.service';
import { businessDaysBetween } from '../common/business-days';
import { PM_REVIEW_STATUS } from '../tasks/pm-review';

export const PM_REMINDER_DEFAULT_DAYS = 2;

// PM review gate reminders (2026-10-13, confirmed with the user). Hourly:
// a ticket that has waited for the PM more than N working days
// (team_settings.pmReminderWorkingDays, default 2) reminds the PMs once;
// past 2N, the Admins once too (when pmReminderToAdmin is on). Each
// reminder is stamped on the round (reminderSentAt / adminReminderSentAt)
// with a guarded update, so it goes out exactly once even if two runs
// overlap. A ticket on Hold/Closed/Junk is skipped (not waiting on the PM).
// In-app only - the listener in UserNotificationListenersService picks
// the recipients. Teams is not wired (no alert path to a chat yet).
@Injectable()
export class PmReviewReminderService {
  private readonly logger = new Logger(PmReviewReminderService.name);

  constructor(
    @InjectRepository(TaskQaReview)
    private reviewsRepository: Repository<TaskQaReview>,
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TeamSettings)
    private teamSettingsRepository: Repository<TeamSettings>,
    private tenantsService: TenantsService,
    private eventEmitter: EventEmitter2,
  ) {}

  @Cron('0 * * * *')
  async run() {
    const tenants = await this.tenantsService.findAll();
    for (const tenant of tenants) {
      try {
        const sent = await this.remindTenant(tenant.id, new Date());
        if (sent.pm.length || sent.admin.length) {
          this.logger.log(`PM review reminders for tenant #${tenant.id}: PM ${sent.pm.length}, Admin ${sent.admin.length}`);
        }
      } catch (err: any) {
        this.logger.error(`PM review reminders failed for tenant #${tenant.id}: ${err.message}`);
      }
    }
  }

  async remindTenant(tenantId: number, now: Date): Promise<{ pm: number[]; admin: number[] }> {
    const settings = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    const days = settings?.pmReminderWorkingDays ?? PM_REMINDER_DEFAULT_DAYS;
    const toAdmin = settings?.pmReminderToAdmin ?? true;
    const rounds = await this.reviewsRepository.find({ where: { tenantId, reviewType: 'pm', status: 'pending' } });
    if (rounds.length === 0) return { pm: [], admin: [] };
    const tasks = await this.tasksRepository.find({
      where: { tenantId, id: In(rounds.map((r) => r.taskId)), status: PM_REVIEW_STATUS },
      select: ['id', 'title'],
    });
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const sent = { pm: [] as number[], admin: [] as number[] };
    for (const r of rounds) {
      const task = taskById.get(r.taskId);
      if (!task) continue;
      const waited = businessDaysBetween(new Date(r.submittedAt), now);
      if (waited > days && !r.reminderSentAt) {
        const upd = await this.reviewsRepository.update({ id: r.id, reminderSentAt: IsNull() }, { reminderSentAt: now });
        if (upd.affected) {
          this.eventEmitter.emit('task.pmReviewReminder', { tenantId, taskId: task.id, title: task.title, waitingWorkingDays: waited, level: 'pm' });
          sent.pm.push(task.id);
        }
      }
      if (toAdmin && waited > days * 2 && !r.adminReminderSentAt) {
        const upd = await this.reviewsRepository.update({ id: r.id, adminReminderSentAt: IsNull() }, { adminReminderSentAt: now });
        if (upd.affected) {
          this.eventEmitter.emit('task.pmReviewReminder', { tenantId, taskId: task.id, title: task.title, waitingWorkingDays: waited, level: 'admin' });
          sent.admin.push(task.id);
        }
      }
    }
    return sent;
  }
}
