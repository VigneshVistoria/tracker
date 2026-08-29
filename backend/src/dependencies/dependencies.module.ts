import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dependency } from './dependency.entity';
import { DependenciesService } from './dependencies.service';
import { DependenciesController } from './dependencies.controller';
import { IssuesModule } from '../issues/issues.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';

// REST CRUD + received/sent inbox views for the first-class Dependency
// entity (ReleaseBot Phase 0 foundations). Escalation timers and the
// #dependency Teams command are still a later phase - this just gets the
// entity's own lifecycle (create/edit/status transitions) callable.
@Module({
  imports: [TypeOrmModule.forFeature([Dependency]), IssuesModule, UsersModule, AuditModule],
  controllers: [DependenciesController],
  providers: [DependenciesService],
  exports: [TypeOrmModule, DependenciesService],
})
export class DependenciesModule {}
