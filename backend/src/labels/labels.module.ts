import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Label } from './label.entity';
import { LabelsService } from './labels.service';
import { LabelsController } from './labels.controller';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Label]), GuardsModule, AuditModule, UsersModule],
  controllers: [LabelsController],
  providers: [LabelsService],
  exports: [LabelsService],
})
export class LabelsModule {}
