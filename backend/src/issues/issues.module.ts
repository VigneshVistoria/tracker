import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Issue } from './issue.entity';
import { IssuesService } from './issues.service';
import { IssuesController } from './issues.controller';
import { IssueAnalyzerService } from './issue-analyzer.service';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [TypeOrmModule.forFeature([Issue]), GuardsModule, UsersModule, ProjectsModule, EventsModule],
  controllers: [IssuesController],
  providers: [IssuesService, IssueAnalyzerService],
  exports: [IssuesService],
})
export class IssuesModule {}
