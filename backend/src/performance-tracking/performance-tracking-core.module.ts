import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { AuditModule } from '../audit/audit.module';
import { PerformanceTrackingSettings } from './performance-tracking-settings.entity';
import { TaskStatusEvent } from './task-status-event.entity';
import { PerformanceTrackingService } from './performance-tracking.service';
import { OwnMetricsVisibilityService } from './own-metrics-visibility.service';

// The settings and per-project switch service on its own (B4, 2026-10-30),
// so the work calendar can read the calendar defaults while the metrics
// (PerformanceTrackingModule) read the work calendar - no import cycle.
@Module({
  imports: [TypeOrmModule.forFeature([Project, User, PerformanceTrackingSettings, TaskStatusEvent]), AuditModule],
  providers: [PerformanceTrackingService, OwnMetricsVisibilityService],
  exports: [PerformanceTrackingService, OwnMetricsVisibilityService],
})
export class PerformanceTrackingCoreModule {}
