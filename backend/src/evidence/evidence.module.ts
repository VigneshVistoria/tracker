import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Evidence } from './evidence.entity';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import { IssuesModule } from '../issues/issues.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';

// Phase 4: multi-artifact submit + viewer, built directly on Phase 0's
// registered entity/repository. GuardsModule provides JwtAuthGuard (and
// its JwtService dependency) for EvidenceController's @UseGuards.
@Module({
  imports: [TypeOrmModule.forFeature([Evidence]), IssuesModule, UsersModule, AuditModule, GuardsModule],
  controllers: [EvidenceController],
  providers: [EvidenceService],
  exports: [TypeOrmModule, EvidenceService],
})
export class EvidenceModule {}
