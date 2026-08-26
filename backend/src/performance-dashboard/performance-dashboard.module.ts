import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Issue } from '../issues/issue.entity';
import { PerformanceDashboardService } from './performance-dashboard.service';
import { PerformanceDashboardController } from './performance-dashboard.controller';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { SlaModule } from '../sla/sla.module';
import { PerformanceScoringModule } from '../performance-scoring/performance-scoring.module';

@Module({
  imports: [TypeOrmModule.forFeature([Issue]), GuardsModule, UsersModule, SlaModule, PerformanceScoringModule],
  controllers: [PerformanceDashboardController],
  providers: [PerformanceDashboardService],
})
export class PerformanceDashboardModule {}
