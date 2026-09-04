import { Module } from '@nestjs/common';
import { OpsService } from './ops.service';
import { OpsController } from './ops.controller';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [GuardsModule, AuditModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
