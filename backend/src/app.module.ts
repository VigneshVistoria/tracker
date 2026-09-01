import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { User } from './users/user.entity';
import { Issue } from './issues/issue.entity';
import { Project } from './projects/project.entity';
import { DailyUpdate } from './daily-updates/daily-update.entity';
import { TeamsSubscription } from './teams-integration/teams-subscription.entity';
import { RegressionTestRun } from './regression-testing/regression-test-run.entity';
import { Sprint } from './sprints/sprint.entity';
import { WeeklyReport } from './reports/weekly-report.entity';
import { Dependency } from './dependencies/dependency.entity';
import { Evidence } from './evidence/evidence.entity';
import { AuditLog } from './audit/audit-log.entity';
import { ProjectModule } from './modules/project-module.entity';
import { TestCase } from './test-cases/test-case.entity';
import { TestExecution } from './test-cases/test-execution.entity';
import { SlaConfig } from './sla/sla-config.entity';
import { PerformanceScoringConfig } from './performance-scoring/performance-scoring-config.entity';
import { OverduePenaltyTier } from './performance-scoring/overdue-penalty-tier.entity';
import { Tenant } from './tenants/tenant.entity';
import { TimeEntry } from './time-sheets/time-entry.entity';
import { IssueCategoryOption } from './issue-categories/issue-category.entity';
import { Team } from './teams/team.entity';
import { Label } from './labels/label.entity';
import { ProjectPlanEntry } from './project-planning/project-plan-entry.entity';
import { Phase } from './phases/phase.entity';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { IssuesModule } from './issues/issues.module';
import { ProjectsModule } from './projects/projects.module';
import { DailyUpdatesModule } from './daily-updates/daily-updates.module';
import { TeamsIntegrationModule } from './teams-integration/teams-integration.module';
import { RegressionTestingModule } from './regression-testing/regression-testing.module';
import { SprintsModule } from './sprints/sprints.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { DependenciesModule } from './dependencies/dependencies.module';
import { EvidenceModule } from './evidence/evidence.module';
import { AuditModule } from './audit/audit.module';
import { ModulesModule } from './modules/modules.module';
import { TestCasesModule } from './test-cases/test-cases.module';
import { SlaModule } from './sla/sla.module';
import { PerformanceScoringModule } from './performance-scoring/performance-scoring.module';
import { PerformanceDashboardModule } from './performance-dashboard/performance-dashboard.module';
import { AiAssistModule } from './ai-assist/ai-assist.module';
import { TenantsModule } from './tenants/tenants.module';
import { TimeSheetsModule } from './time-sheets/time-sheets.module';
import { IssueCategoriesModule } from './issue-categories/issue-categories.module';
import { TeamsModule } from './teams/teams.module';
import { LabelsModule } from './labels/labels.module';
import { ProjectPlanningModule } from './project-planning/project-planning.module';
import { PhasesModule } from './phases/phases.module';
import { ThrottlerModule } from '@nestjs/throttler';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        entities: [
          User,
          Issue,
          Project,
          DailyUpdate,
          TeamsSubscription,
          RegressionTestRun,
          Sprint,
          WeeklyReport,
          Dependency,
          Evidence,
          AuditLog,
          ProjectModule,
          TestCase,
          TestExecution,
          SlaConfig,
          PerformanceScoringConfig,
          OverduePenaltyTier,
          Tenant,
          TimeEntry,
          IssueCategoryOption,
          Team,
          Label,
          ProjectPlanEntry,
          Phase,
        ],
        // synchronize auto-creates tables from entities. Great for
        // learning/dev, but turn this OFF and use migrations in production.
        synchronize: false,
        // Supabase requires SSL. rejectUnauthorized: false is the standard
        // setting for Supabase's connection pooler / direct connection.
        ssl: { rejectUnauthorized: false },
      }),
    }),
    UsersModule,
    AuthModule,
    IssuesModule,
    ProjectsModule,
    DailyUpdatesModule,
    TeamsIntegrationModule,
    RegressionTestingModule,
    SprintsModule,
    NotificationsModule,
    ReportsModule,
    DependenciesModule,
    EvidenceModule,
    AuditModule,
    ModulesModule,
    TestCasesModule,
    SlaModule,
    PerformanceScoringModule,
    PerformanceDashboardModule,
    AiAssistModule,
    TenantsModule,
    TimeSheetsModule,
    IssueCategoriesModule,
    TeamsModule,
    LabelsModule,
    ProjectPlanningModule,
    PhasesModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 20 }]),
  ],
})
export class AppModule {}
