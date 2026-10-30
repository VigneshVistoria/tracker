import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserNotification } from './user-notification.entity';
import { UserNotificationsService } from './user-notifications.service';
import { UserNotificationsController } from './user-notifications.controller';
import { UserNotificationListenersService } from './user-notification-listeners.service';
import { ReturnToQaNotificationsListener } from './return-to-qa-notifications.listener';
import { DefectTriageNotificationsListener } from './defect-triage-notifications.listener';
import { DueDateChangeNotificationsListener } from './due-date-change-notifications.listener';
import { TaskFlagsNotificationsListener } from './task-flags-notifications.listener';
import { SecurityFindingsNotificationsListener } from './security-findings-notifications.listener';
import { GuardsModule } from '../common/guards.module';
import { EventsModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserNotification]), GuardsModule, EventsModule, UsersModule],
  controllers: [UserNotificationsController],
  providers: [UserNotificationsService, UserNotificationListenersService, ReturnToQaNotificationsListener, DefectTriageNotificationsListener, DueDateChangeNotificationsListener, TaskFlagsNotificationsListener, SecurityFindingsNotificationsListener],
})
export class UserNotificationsModule {}
