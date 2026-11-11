import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards.module';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { PerformanceTrackingSettings } from '../performance-tracking/performance-tracking-settings.entity';
import { MeetingOccurrence } from './meeting-occurrence.entity';
import { MeetingAttendance } from './meeting-attendance.entity';
import { MeetingAttendanceImport } from './meeting-attendance-import.entity';
import { MeetingAttendanceService } from './meeting-attendance.service';
import { MeetingAttendanceController } from './meeting-attendance.controller';
import { MeetingImportService } from './meeting-import.service';
import { MeetingGraphClient } from './meeting-graph.client';
import { GraphAuthService } from '../teams-integration/graph-auth.service';
import { TenantsModule } from '../tenants/tenants.module';

// Performance Tracking C6 - meeting attendance from Teams (2026-11-11).
@Module({
  imports: [
    TypeOrmModule.forFeature([PerformanceTrackingSettings, Project, User, MeetingOccurrence, MeetingAttendance, MeetingAttendanceImport]),
    AuditModule,
    UsersModule,
    GuardsModule,
    TenantsModule,
  ],
  controllers: [MeetingAttendanceController],
  // GraphAuthService: its own instance (own token cache) - the Teams
  // module does not export it.
  providers: [MeetingAttendanceService, MeetingImportService, MeetingGraphClient, GraphAuthService],
  exports: [MeetingAttendanceService],
})
export class MeetingAttendanceModule {}
