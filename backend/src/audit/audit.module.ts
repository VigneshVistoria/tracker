import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';
import { TaskCommitmentEvent } from '../performance-metrics/task-commitment-event.entity';

// Exported (not just the repository) so any module can call
// AuditLogService.record(...) directly - Phase 1's unauthorized-attempt
// logging is the first real caller. TaskCommitmentEvent: assignment and
// Due date entries also write a performance metrics event (see
// AuditLogService.commitmentEventFor()).
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, TaskCommitmentEvent])],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
