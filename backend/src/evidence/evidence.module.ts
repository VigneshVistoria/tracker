import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Evidence } from './evidence.entity';

// Foundations-only for now (ReleaseBot Phase 0): registers the entity so
// Phase 4 (the mandatory-evidence gate + viewer/preview panel) can inject
// its repository without more module plumbing.
@Module({
  imports: [TypeOrmModule.forFeature([Evidence])],
  exports: [TypeOrmModule],
})
export class EvidenceModule {}
