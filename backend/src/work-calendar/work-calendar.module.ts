import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonWorkCalendar } from './person-work-calendar.entity';
import { PersonLeave } from './person-leave.entity';
import { CountryHoliday } from './country-holiday.entity';
import { WorkCalendarService } from './work-calendar.service';
import { WorkCalendarController } from './work-calendar.controller';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { PerformanceMetricsModule } from '../performance-metrics/performance-metrics.module';
import { PerformanceTrackingCoreModule } from '../performance-tracking/performance-tracking-core.module';

// B4 (2026-10-30) - per-person working calendar. Exported for the metrics.
@Module({
  imports: [TypeOrmModule.forFeature([PersonWorkCalendar, PersonLeave, CountryHoliday]), UsersModule, AuditModule, GuardsModule, PerformanceMetricsModule, PerformanceTrackingCoreModule],
  controllers: [WorkCalendarController],
  providers: [WorkCalendarService],
  exports: [WorkCalendarService],
})
export class WorkCalendarModule {}
