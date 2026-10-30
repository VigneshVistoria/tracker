import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskRequest } from './task-request.entity';
import { TaskRequestsService } from './task-requests.service';
import { TaskRequestsController } from './task-requests.controller';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';

// Performance Tracking B4 (2026-10-30) - requests on a task (C1).
@Module({
  imports: [TypeOrmModule.forFeature([TaskRequest]), TasksModule, UsersModule, AuditModule, GuardsModule],
  controllers: [TaskRequestsController],
  providers: [TaskRequestsService],
})
export class TaskRequestsModule {}
