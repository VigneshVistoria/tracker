import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Phase } from './phase.entity';
import { PhasesService } from './phases.service';
import { PhasesController } from './phases.controller';
import { Issue } from '../issues/issue.entity';
import { ProjectPlanEntry } from '../project-planning/project-plan-entry.entity';
import { ModulesModule } from '../modules/modules.module';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Phase, Issue, ProjectPlanEntry]),
    ModulesModule,
    GuardsModule,
    AuditModule,
    UsersModule,
  ],
  controllers: [PhasesController],
  providers: [PhasesService],
  exports: [PhasesService],
})
export class PhasesModule {}
