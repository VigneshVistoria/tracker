import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Release } from './release.entity';
import { ReleaseItem } from './release-item.entity';
import { ReleaseLogsService } from './release-logs.service';
import { ReleaseLogsController } from './release-logs.controller';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Release, ReleaseItem, ProjectTask, TaskQaReview]),
    GuardsModule,
    AuditModule,
    UsersModule,
    ProjectsModule,
  ],
  controllers: [ReleaseLogsController],
  providers: [ReleaseLogsService],
})
export class ReleaseLogsModule {}
