import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Evidence } from './evidence.entity';
import { CreateEvidenceItemDto } from './dto/create-evidence.dto';
import { UserRole } from '../users/user.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface EvidenceSubmission {
  batchId: string;
  submittedByUserId: number;
  submittedByEmail: string;
  createdAt: Date;
  items: Array<Pick<Evidence, 'id' | 'type' | 'url' | 'comments'>>;
}

@Injectable()
export class EvidenceService {
  constructor(
    @InjectRepository(Evidence)
    private evidenceRepository: Repository<Evidence>,
    private auditLogService: AuditLogService,
  ) {}

  // Groups the issue's evidence rows by the batchId they were submitted
  // together under, newest submission first, so the viewer can render
  // each multi-artifact submission as one dated entry with several
  // artifacts rather than one entry per artifact.
  async findForIssue(issueId: number, tenantId: number): Promise<EvidenceSubmission[]> {
    const rows = await this.evidenceRepository.find({
      where: { issueId, tenantId },
      order: { createdAt: 'DESC' },
    });

    const byBatch = new Map<string, Evidence[]>();
    for (const row of rows) {
      const key = row.batchId || `row-${row.id}`; // pre-batch rows (if any) stand alone
      const group = byBatch.get(key) || [];
      group.push(row);
      byBatch.set(key, group);
    }

    return Array.from(byBatch.values()).map((items) => ({
      batchId: items[0].batchId || `row-${items[0].id}`,
      submittedByUserId: items[0].submittedByUserId,
      submittedByEmail: items[0].submittedByEmail,
      createdAt: items[0].createdAt,
      items: items.map(({ id, type, url, comments }) => ({ id, type, url, comments })),
    }));
  }

  // One row per selected Artifact Type, all sharing a freshly generated
  // batchId, saved together in a transaction so a submission can never
  // land partially. There's no separate submission-level title in this
  // feature, so each row's title is just its own Artifact Type label.
  async createBatch(
    issueId: number,
    items: CreateEvidenceItemDto[],
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<EvidenceSubmission> {
    const batchId = randomUUID();

    const saved = await this.evidenceRepository.manager.transaction(async (manager) => {
      const rows = items.map((item) =>
        manager.create(Evidence, {
          tenantId,
          issueId,
          title: item.type,
          type: item.type,
          url: item.url,
          comments: item.comments || null,
          submittedByUserId: currentUser.id,
          submittedByEmail: currentUser.email,
          batchId,
        }),
      );
      return manager.save(Evidence, rows);
    });

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.EVIDENCE_SUBMITTED,
      tenantId,
      entityType: 'Issue',
      entityId: issueId,
      details: { batchId, types: items.map((item) => item.type) },
    });

    return {
      batchId,
      submittedByUserId: currentUser.id,
      submittedByEmail: currentUser.email,
      createdAt: saved[0].createdAt,
      items: saved.map(({ id, type, url, comments }) => ({ id, type, url, comments })),
    };
  }
}
