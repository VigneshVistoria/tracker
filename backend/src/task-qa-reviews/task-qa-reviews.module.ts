import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskQaReview } from './task-qa-review.entity';
import { TaskQaReviewArtifact } from './task-qa-review-artifact.entity';
import { TaskQaReviewsService } from './task-qa-reviews.service';
import { TaskQaReviewsController } from './task-qa-reviews.controller';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskQaReview, TaskQaReviewArtifact, ProjectTask]),
    TasksModule,
    UsersModule,
    AuditModule,
    GuardsModule,
  ],
  controllers: [TaskQaReviewsController],
  providers: [TaskQaReviewsService],
  exports: [TaskQaReviewsService],
})
export class TaskQaReviewsModule {}
