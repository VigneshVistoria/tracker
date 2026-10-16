import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { AuditActions, AuditLogService } from '../audit/audit-log.service';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { ExternalWaitStatus, ScrumExternalWait } from './scrum-external-wait.entity';
import { CreateExternalWaitDto, UpdateExternalWaitDto } from './dto/external-wait.dto';

// The fields an add/edit can change - and that the audit entry records.
const EDITABLE = ['title', 'party', 'taskId', 'followUpUserId', 'requestedOn', 'expectedBy', 'note', 'status'] as const;
type Editable = Pick<ScrumExternalWait, (typeof EDITABLE)[number]>;

export interface ExternalWaitView extends Editable {
  id: number;
  taskTitle: string | null;
  followUpName: string | null;
  createdByName: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedByName: string | null;
}

type Actor = { id: number; email: string; role: UserRole };

// Daily Scrum Stage 3: "Waiting on the city office". Only touches its own
// table (scrum_external_waits) and audit_logs - never a ticket.
@Injectable()
export class ExternalWaitsService {
  constructor(
    @InjectRepository(ScrumExternalWait) private readonly waitsRepository: Repository<ScrumExternalWait>,
    @InjectRepository(ProjectTask) private readonly tasksRepository: Repository<ProjectTask>,
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Open ones oldest first (longest wait at the top); resolved ones most
  // recently resolved first.
  async list(tenantId: number, status: ExternalWaitStatus | 'all' = 'open'): Promise<ExternalWaitView[]> {
    const rows = await this.waitsRepository.find({
      where: status === 'all' ? { tenantId } : { tenantId, status },
      order: { requestedOn: 'ASC', id: 'ASC' },
    });
    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.status === 'resolved') return (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0);
      return 0;
    });
    return this.toViews(rows, tenantId);
  }

  async create(dto: CreateExternalWaitDto, actor: Actor, tenantId: number): Promise<ExternalWaitView> {
    const values: Editable = {
      title: dto.title,
      party: dto.party || 'City office',
      taskId: dto.taskId ?? null,
      followUpUserId: dto.followUpUserId ?? null,
      requestedOn: dto.requestedOn,
      expectedBy: dto.expectedBy ?? null,
      note: dto.note?.trim() || null,
      status: 'open',
    };
    await this.check(values, tenantId);
    const saved = await this.waitsRepository.manager.transaction(async (em) => {
      const repo = em.getRepository(ScrumExternalWait);
      const row = await repo.save(repo.create({ tenantId, ...values, createdByUserId: actor.id, updatedByUserId: actor.id }));
      await this.auditLogService.recordWithin(em, {
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: AuditActions.DAILY_SCRUM_EXTERNAL_WAIT_CREATED,
        tenantId,
        entityType: 'ScrumExternalWait',
        entityId: row.id,
        details: { after: values },
      });
      return row;
    });
    return (await this.toViews([saved], tenantId))[0];
  }

  async update(id: number, dto: UpdateExternalWaitDto, actor: Actor, tenantId: number): Promise<ExternalWaitView> {
    const row = await this.waitsRepository.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException(`External wait #${id} not found.`);
    const before = pick(row);
    const after: Editable = { ...before };
    for (const key of EDITABLE) {
      if (dto[key] !== undefined) (after as any)[key] = dto[key];
    }
    if (dto.note !== undefined) after.note = dto.note?.trim() || null;
    await this.check(after, tenantId);

    const changed = EDITABLE.filter((k) => before[k] !== after[k]);
    if (changed.length === 0) return (await this.toViews([row], tenantId))[0];

    const saved = await this.waitsRepository.manager.transaction(async (em) => {
      const repo = em.getRepository(ScrumExternalWait);
      Object.assign(row, after, { updatedByUserId: actor.id });
      if (before.status !== after.status) {
        row.resolvedAt = after.status === 'resolved' ? new Date() : null;
        row.resolvedByUserId = after.status === 'resolved' ? actor.id : null;
      }
      const result = await repo.save(row);
      const action =
        before.status === after.status
          ? AuditActions.DAILY_SCRUM_EXTERNAL_WAIT_UPDATED
          : after.status === 'resolved'
            ? AuditActions.DAILY_SCRUM_EXTERNAL_WAIT_RESOLVED
            : AuditActions.DAILY_SCRUM_EXTERNAL_WAIT_REOPENED;
      await this.auditLogService.recordWithin(em, {
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action,
        tenantId,
        entityType: 'ScrumExternalWait',
        entityId: row.id,
        details: {
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k]])),
        },
      });
      return result;
    });
    return (await this.toViews([saved], tenantId))[0];
  }

  // A linked ticket and follow-up person must be in this tenant; the
  // expected date can't be before the request.
  private async check(values: Editable, tenantId: number) {
    if (values.taskId != null) {
      const task = await this.tasksRepository.findOne({ where: { id: values.taskId, tenantId }, select: ['id'] });
      if (!task) throw new BadRequestException(`Ticket #${values.taskId} not found.`);
    }
    if (values.followUpUserId != null) {
      const user = await this.usersService.findByIdAndTenant(values.followUpUserId, tenantId);
      if (!user || user.role === UserRole.CLIENT) throw new BadRequestException('The follow-up person must be a team member.');
    }
    if (values.expectedBy && values.expectedBy < values.requestedOn) {
      throw new BadRequestException('Expected by can\'t be before Requested on.');
    }
  }

  private async toViews(rows: ScrumExternalWait[], tenantId: number): Promise<ExternalWaitView[]> {
    if (rows.length === 0) return [];
    const users = await this.usersService.findAll(tenantId);
    const names = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    const taskIds = [...new Set(rows.map((r) => r.taskId).filter((id): id is number => id != null))];
    const tasks = taskIds.length
      ? await this.tasksRepository.find({ where: { tenantId, id: In(taskIds) }, select: ['id', 'title'] })
      : [];
    const titles = new Map(tasks.map((t) => [t.id, t.title]));
    const name = (id: number | null) => (id != null ? names.get(id) ?? null : null);
    return rows.map((r) => ({
      id: r.id,
      ...pick(r),
      taskTitle: r.taskId != null ? titles.get(r.taskId) ?? null : null,
      followUpName: name(r.followUpUserId),
      createdByName: name(r.createdByUserId),
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      resolvedByName: name(r.resolvedByUserId),
    }));
  }
}

function pick(row: ScrumExternalWait): Editable {
  return Object.fromEntries(EDITABLE.map((k) => [k, row[k] ?? null])) as Editable;
}
