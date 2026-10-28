import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { PerformanceTrackingSettings } from './performance-tracking-settings.entity';
import { TaskStatusEvent } from './task-status-event.entity';
import { PerformanceTrackingService } from './performance-tracking.service';
import { PerformanceTrackingController } from './performance-tracking.controller';

// Performance Tracking, Wave 1 (2026-10-28). task_status_events is written
// by database triggers, not here - see ./task-status-event.entity.ts.
@Module({
  imports: [TypeOrmModule.forFeature([Project, PerformanceTrackingSettings, TaskStatusEvent]), UsersModule, GuardsModule, AuditModule],
  controllers: [PerformanceTrackingController],
  providers: [PerformanceTrackingService],
  exports: [PerformanceTrackingService],
})
export class PerformanceTrackingModule {}
