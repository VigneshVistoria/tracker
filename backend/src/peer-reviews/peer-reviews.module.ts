import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { TaskQaReviewArtifact } from '../task-qa-reviews/task-qa-review-artifact.entity';
import { TaskQaReviewQaArtifact } from '../task-qa-reviews/task-qa-review-qa-artifact.entity';
import { PeerReviewsService } from './peer-reviews.service';
import { PeerReviewsController } from './peer-reviews.controller';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskQaReview, TaskQaReviewArtifact, TaskQaReviewQaArtifact, ProjectTask]),
    TasksModule,
    UsersModule,
    AuditModule,
    GuardsModule,
  ],
  controllers: [PeerReviewsController],
  providers: [PeerReviewsService],
  exports: [PeerReviewsService],
})
export class PeerReviewsModule {}
