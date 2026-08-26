import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Issue } from './issue.entity';
import { Sprint } from '../sprints/sprint.entity';
import { ProjectModule } from '../modules/project-module.entity';
import { IssuesService } from './issues.service';
import { IssuesController } from './issues.controller';
import { IssueAnalyzerService } from './issue-analyzer.service';
import { ShowstopperValidatorService } from './showstopper-validator.service';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { EventsModule } from '../events/events.module';
import { AuditModule } from '../audit/audit.module';
import { SlaModule } from '../sla/sla.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Issue, Sprint, ProjectModule]),
    GuardsModule,
    UsersModule,
    ProjectsModule,
    EventsModule,
    AuditModule,
    SlaModule,
  ],
  controllers: [IssuesController],
  providers: [IssuesService, IssueAnalyzerService, ShowstopperValidatorService],
  exports: [IssuesService, IssueAnalyzerService],
})
export class IssuesModule {}
