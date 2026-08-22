import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dependency } from './dependency.entity';

// Foundations-only for now (ReleaseBot Phase 0): registers the entity so
// later phases can inject its repository without more module plumbing.
// The workflow, escalation timers, and #dependency Teams command land in
// Phase 3.
@Module({
  imports: [TypeOrmModule.forFeature([Dependency])],
  exports: [TypeOrmModule],
})
export class DependenciesModule {}
