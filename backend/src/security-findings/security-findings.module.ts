import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityFinding } from './security-finding.entity';
import { User } from '../users/user.entity';
import { SecurityFindingsService } from './security-findings.service';
import { SecurityFindingsController } from './security-findings.controller';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { PerformanceTrackingCoreModule } from '../performance-tracking/performance-tracking-core.module';
import { PerformanceMetricsModule } from '../performance-metrics/performance-metrics.module';

// Performance Tracking P3/P4 (2026-10-30) - security findings.
@Module({
  imports: [TypeOrmModule.forFeature([SecurityFinding, User]), UsersModule, AuditModule, GuardsModule, PerformanceTrackingCoreModule, PerformanceMetricsModule],
  controllers: [SecurityFindingsController],
  providers: [SecurityFindingsService],
})
export class SecurityFindingsModule {}
