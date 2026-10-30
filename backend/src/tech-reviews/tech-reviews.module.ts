import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TechReview } from './tech-review.entity';
import { TechReviewEvidence } from './tech-review-evidence.entity';
import { User } from '../users/user.entity';
import { TechReviewsService } from './tech-reviews.service';
import { TechReviewsController } from './tech-reviews.controller';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { PerformanceTrackingCoreModule } from '../performance-tracking/performance-tracking-core.module';

// Performance Tracking Q5 (2026-10-30) - technical review.
@Module({
  imports: [TypeOrmModule.forFeature([TechReview, TechReviewEvidence, User]), UsersModule, AuditModule, GuardsModule, PerformanceTrackingCoreModule],
  controllers: [TechReviewsController],
  providers: [TechReviewsService],
})
export class TechReviewsModule {}
