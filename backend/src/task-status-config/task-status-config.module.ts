import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskStatusPercent } from './task-status-percent.entity';
import { TaskStatusConfigService } from './task-status-config.service';
import { TaskStatusConfigController } from './task-status-config.controller';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([TaskStatusPercent]), GuardsModule, AuditModule],
  controllers: [TaskStatusConfigController],
  providers: [TaskStatusConfigService],
  exports: [TaskStatusConfigService],
})
export class TaskStatusConfigModule {}
