import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ArtifactType } from './artifact-type.entity';
import { ArtifactTypeRule } from './artifact-type-rule.entity';
import { ArtifactTypesService } from './artifact-types.service';

// No controller of its own: the admin endpoints live on
// SubmissionChecklistController (one settings screen, same editor roles).
@Module({
  imports: [TypeOrmModule.forFeature([ArtifactType, ArtifactTypeRule]), AuditModule],
  providers: [ArtifactTypesService],
  exports: [ArtifactTypesService],
})
export class ArtifactTypesModule {}
