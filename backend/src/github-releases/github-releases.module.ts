import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { Project } from '../projects/project.entity';
import { Release } from '../release-logs/release.entity';
import { ReleaseLogsModule } from '../release-logs/release-logs.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { TasksModule } from '../tasks/tasks.module';
import { GithubApiService } from './github-api.service';
import { GithubReleasesController, GithubWebhookController } from './github-releases.controller';
import { GithubRepoMapping, GithubSettings, GithubStagingDeployment, GithubStageDeployment, GithubWebhookDelivery, TaskStageProgress } from './github-releases.entity';
import { GithubReleasesService } from './github-releases.service';

// Performance Tracking P1/P2 from GitHub - see ./github-releases.ts.
@Module({
  imports: [
    TypeOrmModule.forFeature([GithubSettings, GithubRepoMapping, GithubWebhookDelivery, GithubStagingDeployment, GithubStageDeployment, TaskStageProgress, Release, User, Project]),
    GuardsModule,
    AuditModule,
    UsersModule,
    ReleaseLogsModule,
    TasksModule,
  ],
  controllers: [GithubWebhookController, GithubReleasesController],
  providers: [GithubReleasesService, GithubApiService],
})
export class GithubReleasesModule {}
