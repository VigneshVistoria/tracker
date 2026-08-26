import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PerformanceScoringConfig } from './performance-scoring-config.entity';
import { OverduePenaltyTier } from './overdue-penalty-tier.entity';
import { PerformanceScoringService } from './performance-scoring.service';
import { PerformanceScoringController } from './performance-scoring.controller';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([PerformanceScoringConfig, OverduePenaltyTier]), GuardsModule, AuditModule],
  controllers: [PerformanceScoringController],
  providers: [PerformanceScoringService],
  exports: [PerformanceScoringService],
})
export class PerformanceScoringModule {}
