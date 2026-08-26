import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SlaConfig } from './sla-config.entity';
import { SlaService } from './sla.service';
import { SlaController } from './sla.controller';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([SlaConfig]), GuardsModule, AuditModule],
  controllers: [SlaController],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
