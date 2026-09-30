import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestCase } from './test-case.entity';
import { TestExecution } from './test-execution.entity';
import { TestCaseCustomField } from './test-case-custom-field.entity';
import { TestCasesService } from './test-cases.service';
import { TestCasesController } from './test-cases.controller';
import { TestCaseCustomFieldsService } from './test-case-custom-fields.service';
import { TestCaseCustomFieldsController } from './test-case-custom-fields.controller';
import { TestCaseTemplateSettings } from './test-case-template-settings.entity';
import { TestCaseTemplateSettingsService } from './test-case-template-settings.service';
import { TestCaseTemplateSettingsController } from './test-case-template-settings.controller';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { ModulesModule } from '../modules/modules.module';
import { PhasesModule } from '../phases/phases.module';
import { AuditModule } from '../audit/audit.module';
import { LabelsModule } from '../labels/labels.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestCase, TestExecution, TestCaseCustomField, TestCaseTemplateSettings]),
    GuardsModule,
    UsersModule,
    ProjectsModule,
    ModulesModule,
    PhasesModule,
    AuditModule,
    LabelsModule,
  ],
  controllers: [TestCasesController, TestCaseCustomFieldsController, TestCaseTemplateSettingsController],
  providers: [TestCasesService, TestCaseCustomFieldsService, TestCaseTemplateSettingsService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
