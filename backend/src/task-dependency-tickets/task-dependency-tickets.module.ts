import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskDependencyTicket } from './task-dependency-ticket.entity';
import { TaskDependencyTicketsService } from './task-dependency-tickets.service';
import { TaskDependencyTicketsController } from './task-dependency-tickets.controller';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';

@Module({
  imports: [TypeOrmModule.forFeature([TaskDependencyTicket]), TasksModule, UsersModule, AuditModule, GuardsModule],
  controllers: [TaskDependencyTicketsController],
  providers: [TaskDependencyTicketsService],
  exports: [TaskDependencyTicketsService],
})
export class TaskDependencyTicketsModule {}
