import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskHandover } from './task-handover.entity';
import { User } from '../users/user.entity';
import { TaskHandoversService } from './task-handovers.service';
import { TaskHandoversController } from './task-handovers.controller';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { PerformanceTrackingCoreModule } from '../performance-tracking/performance-tracking-core.module';

// Performance Tracking C4 (2026-10-30) - handover.
@Module({
  imports: [TypeOrmModule.forFeature([TaskHandover, User]), TasksModule, UsersModule, AuditModule, GuardsModule, PerformanceTrackingCoreModule],
  controllers: [TaskHandoversController],
  providers: [TaskHandoversService],
})
export class TaskHandoversModule {}
