import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SlaConfig } from './sla-config.entity';
import { Issue } from '../issues/issue.entity';
import { SlaService } from './sla.service';
import { SlaController } from './sla.controller';
import { SlaDueSoonSchedulerService } from './sla-due-soon-scheduler.service';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TypeOrmModule.forFeature([SlaConfig, Issue]), GuardsModule, AuditModule, TenantsModule],
  controllers: [SlaController],
  providers: [SlaService, SlaDueSoonSchedulerService],
  exports: [SlaService],
})
export class SlaModule {}
