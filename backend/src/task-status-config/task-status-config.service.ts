import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskStatusPercent, TASK_STATUSES } from './task-status-percent.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

@Injectable()
export class TaskStatusConfigService {
  constructor(
    @InjectRepository(TaskStatusPercent)
    private configRepository: Repository<TaskStatusPercent>,
    private auditLogService: AuditLogService,
  ) {}

  async findAllForTenant(tenantId: number): Promise<TaskStatusPercent[]> {
    const rows = await this.configRepository.find({ where: { tenantId } });
    return rows.sort((a, b) => TASK_STATUSES.indexOf(a.status as any) - TASK_STATUSES.indexOf(b.status as any));
  }

  // Fetched once per request by TasksService and reused across every task
  // row - same "fetch once, reuse" approach IssuesController.attachSlaToMany
  // uses for SLA config.
  async percentByStatus(tenantId: number): Promise<Record<string, number>> {
    const rows = await this.configRepository.find({ where: { tenantId } });
    return Object.fromEntries(rows.map((r) => [r.status, r.percent]));
  }

  async update(
    id: number,
    percent: number,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<TaskStatusPercent> {
    const row = await this.configRepository.findOne({ where: { id, tenantId } });
    if (!row) {
      throw new NotFoundException(`Task status config #${id} not found`);
    }
    const previousPercent = row.percent;
    row.percent = percent;
    row.updatedByUserId = user.id;
    row.updatedByEmail = user.email;
    const saved = await this.configRepository.save(row);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TASK_STATUS_PERCENT_UPDATED,
      tenantId,
      entityType: 'TaskStatusPercent',
      entityId: saved.id,
      details: { status: saved.status, previousPercent, percent },
    });

    return saved;
  }
}
