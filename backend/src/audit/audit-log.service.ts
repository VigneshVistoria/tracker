import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

// Known action strings, kept as constants (not a Postgres enum - see the
// entity for why) so later phases spell them consistently instead of each
// call site inventing its own string. Add to this list as new phases need
// new event types; nothing here is exhaustive of the final Section 39
// list yet, just what Phase 0/1 already need.
export const AuditActions = {
  TICKET_CREATION_BLOCKED: 'ticket_creation_blocked',
  TICKET_CREATED: 'ticket_created',
  SLA_CONFIG_UPDATED: 'sla_config_updated',
  SHOWSTOPPER_FLAGGED_FOR_REVIEW: 'showstopper_flagged_for_review',
  SHOWSTOPPER_REVIEW_DECIDED: 'showstopper_review_decided',
  SCORING_CONFIG_UPDATED: 'scoring_config_updated',
  OVERDUE_TIER_CREATED: 'overdue_tier_created',
  OVERDUE_TIER_UPDATED: 'overdue_tier_updated',
  OVERDUE_TIER_DELETED: 'overdue_tier_deleted',
  DEPENDENCY_CREATED: 'dependency_created',
  DEPENDENCY_UPDATED: 'dependency_updated',
  DEPENDENCY_STATUS_CHANGED: 'dependency_status_changed',
  BULK_IMPORT_BLOCKED: 'bulk_import_blocked',
  BULK_IMPORT_VALIDATION_FAILED: 'bulk_import_validation_failed',
  BULK_IMPORT_COMPLETED: 'bulk_import_completed',
} as const;

export interface RecordAuditEntryInput {
  userId?: number | null;
  userEmail?: string | null;
  userRole?: string | null;
  action: string;
  entityType?: string;
  entityId?: number;
  details?: Record<string, unknown>;
  tenantId: number;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  // Deliberately swallows its own errors (logged, not thrown) - a broken
  // audit write should never be the reason a real request fails. Callers
  // should treat this as fire-and-forget.
  async record(input: RecordAuditEntryInput): Promise<void> {
    try {
      const entry = this.auditLogRepository.create({
        userId: input.userId ?? null,
        userEmail: input.userEmail ?? null,
        userRole: input.userRole ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        details: input.details ? JSON.stringify(input.details) : null,
        tenantId: input.tenantId,
      });
      await this.auditLogRepository.save(entry);
    } catch (err: any) {
      this.logger.error(`Failed to write audit log entry (action=${input.action}): ${err.message}`);
    }
  }
}
