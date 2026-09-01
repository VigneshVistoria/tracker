import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Issue } from './issue.entity';
import { Sprint } from '../sprints/sprint.entity';
import { ProjectModule } from '../modules/project-module.entity';
import { IssuesService } from './issues.service';
import { IssuesController } from './issues.controller';
import { IssuesBulkController } from './issues-bulk.controller';
import { IssuesBulkService } from './issues-bulk.service';
import { IssueSpreadsheetService } from './spreadsheet/issue-spreadsheet.service';
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
  // IssuesBulkController registered first - it owns the more specific
  // `bulk-export`/`bulk-import` routes under the shared `issues` prefix,
  // and must be matched before IssuesController's `:id` catch-all below.
  controllers: [IssuesBulkController, IssuesController],
  providers: [IssuesService, IssueAnalyzerService, ShowstopperValidatorService, IssuesBulkService, IssueSpreadsheetService],
  exports: [IssuesService, IssueAnalyzerService],
})
export class IssuesModule {}
