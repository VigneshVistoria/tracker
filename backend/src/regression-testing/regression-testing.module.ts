import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegressionTestRun } from './regression-test-run.entity';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { Issue } from '../issues/issue.entity';
import { DailyUpdate } from '../daily-updates/daily-update.entity';
import { RegressionTestingService } from './regression-testing.service';
import { RegressionTestingController } from './regression-testing.controller';
import { GuardsModule } from '../common/guards.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { IssuesModule } from '../issues/issues.module';
import { DailyUpdatesModule } from '../daily-updates/daily-updates.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RegressionTestRun, User, Project, Issue, DailyUpdate]),
    GuardsModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    IssuesModule,
    DailyUpdatesModule,
    EventsModule,
  ],
  controllers: [RegressionTestingController],
  providers: [RegressionTestingService],
})
export class RegressionTestingModule {}
