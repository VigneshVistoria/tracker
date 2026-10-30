import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskChase } from './task-chase.entity';
import { TaskProgressNote } from './task-progress-note.entity';
import { TaskActivityService } from './task-activity.service';
import { TaskActivityController } from './task-activity.controller';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { PerformanceTrackingCoreModule } from '../performance-tracking/performance-tracking-core.module';

// Performance Tracking B1 (2026-10-30) - Chase (O3) and progress notes (C5).
@Module({
  imports: [TypeOrmModule.forFeature([TaskChase, TaskProgressNote]), TasksModule, UsersModule, AuditModule, GuardsModule, PerformanceTrackingCoreModule],
  controllers: [TaskActivityController],
  providers: [TaskActivityService],
})
export class TaskActivityModule {}
