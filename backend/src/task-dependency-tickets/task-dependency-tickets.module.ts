import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskDependencyTicket } from './task-dependency-ticket.entity';
import { TaskDependencyTicketsService } from './task-dependency-tickets.service';
import { TaskDependencyTicketsController } from './task-dependency-tickets.controller';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { Project } from '../projects/project.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TaskDependencyTicketAttachment } from './task-dependency-ticket-attachment.entity';
import { TaskDependencyTicketAttachmentsService } from './task-dependency-ticket-attachments.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([TaskDependencyTicket, TaskDependencyTicketAttachment, Project, TeamSettings]), TasksModule, UsersModule, AuditModule, GuardsModule, StorageModule],
  controllers: [TaskDependencyTicketsController],
  providers: [TaskDependencyTicketsService, TaskDependencyTicketAttachmentsService],
  exports: [TaskDependencyTicketsService],
})
export class TaskDependencyTicketsModule {}
