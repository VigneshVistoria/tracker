import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectPlanEntry, ProjectPlanStatus } from './project-plan-entry.entity';
import { CreateProjectPlanEntryDto } from './dto/create-project-plan-entry.dto';
import { UpdateProjectPlanEntryDto } from './dto/update-project-plan-entry.dto';
import { ProjectTask } from '../tasks/project-task.entity';
import { DONE_TASK_STATUSES, EXCLUDED_TASK_STATUSES } from '../modules/modules.service';
import { ProjectsService } from '../projects/projects.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface ProjectPlanEntryWithCompletion extends ProjectPlanEntry {
  percentComplete: number | null;
  completedTaskCount: number;
  totalTaskCount: number;
}

@Injectable()
export class ProjectPlanningService {
  constructor(
    @InjectRepository(ProjectPlanEntry)
    private entriesRepository: Repository<ProjectPlanEntry>,
    @InjectRepository(ProjectTask)
    private projectTasksRepository: Repository<ProjectTask>,
    private projectsService: ProjectsService,
    private auditLogService: AuditLogService,
  ) {}

  private assertValidDateRange(startDate: string, targetDate: string): void {
    if (targetDate < startDate) {
      throw new BadRequestException('Target Date must be on or after Start Date.');
    }
  }

  // Completion is never stored - always computed live from the Tasks
  // (project_tasks) in scope, same rule as the Project Overview / Modules
  // list: Pass/Closed/Released done, Junk left out. Scope is Project
  // (always) + Module/Phase if set on the entry - Team is never part of the
  // scope. No counted tasks -> percentComplete: null, distinct from "0%
  // done" (which means work exists but none is done).
  private async computeCompletion(entry: ProjectPlanEntry): Promise<ProjectPlanEntryWithCompletion> {
    const qb = this.projectTasksRepository
      .createQueryBuilder('t')
      .select('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE t.status IN (:...done))', 'done')
      .where('t.tenantId = :tenantId', { tenantId: entry.tenantId })
      .andWhere('t.projectId = :projectId', { projectId: entry.projectId })
      .andWhere('t.status NOT IN (:...excluded)', { excluded: EXCLUDED_TASK_STATUSES })
      .setParameter('done', DONE_TASK_STATUSES);
    if (entry.moduleId != null) qb.andWhere('t.moduleId = :moduleId', { moduleId: entry.moduleId });
    if (entry.phaseId != null) qb.andWhere('t.phaseId = :phaseId', { phaseId: entry.phaseId });

    const row = await qb.getRawOne<{ total: string; done: string }>();
    const totalTaskCount = Number(row?.total ?? 0);
    if (totalTaskCount === 0) {
      return { ...entry, percentComplete: null, completedTaskCount: 0, totalTaskCount: 0 };
    }
    const completedTaskCount = Number(row.done);
    const percentComplete = Math.round((completedTaskCount / totalTaskCount) * 100);
    return { ...entry, percentComplete, completedTaskCount, totalTaskCount };
  }

  async findAll(tenantId: number): Promise<ProjectPlanEntryWithCompletion[]> {
    const entries = await this.entriesRepository.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
    return Promise.all(entries.map((entry) => this.computeCompletion(entry)));
  }

  async findOne(id: number, tenantId: number): Promise<ProjectPlanEntry> {
    const entry = await this.entriesRepository.findOne({ where: { id, tenantId } });
    if (!entry) {
      throw new NotFoundException(`Project Planning entry #${id} not found`);
    }
    return entry;
  }

  async findOneWithCompletion(id: number, tenantId: number): Promise<ProjectPlanEntryWithCompletion> {
    const entry = await this.findOne(id, tenantId);
    return this.computeCompletion(entry);
  }

  async create(
    dto: CreateProjectPlanEntryDto,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<ProjectPlanEntry> {
    this.assertValidDateRange(dto.startDate, dto.targetDate);
    // Validated the same way Dependency validates impactedIssueId - throws
    // NotFoundException if the project doesn't exist. projectName is
    // always resolved from here, never trusted from the client.
    const project = await this.projectsService.findOne(dto.projectId, tenantId);

    const entry = this.entriesRepository.create({
      projectId: project.id,
      projectName: project.name,
      moduleId: dto.moduleId ?? null,
      moduleName: dto.moduleName ?? null,
      phaseId: dto.phaseId ?? null,
      phaseName: dto.phaseName ?? null,
      teamId: dto.teamId ?? null,
      teamName: dto.teamName ?? null,
      startDate: dto.startDate,
      targetDate: dto.targetDate,
      status: dto.status ?? 'ToDo',
      createdByUserId: user.id,
      createdByEmail: user.email,
      tenantId,
    });
    const saved = await this.entriesRepository.save(entry);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.PROJECT_PLAN_CREATED,
      tenantId,
      entityType: 'ProjectPlanEntry',
      entityId: saved.id,
      details: { projectId: saved.projectId, moduleId: saved.moduleId, phaseId: saved.phaseId, teamId: saved.teamId },
    });

    return saved;
  }

  async update(
    id: number,
    dto: UpdateProjectPlanEntryDto,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<ProjectPlanEntry> {
    const entry = await this.findOne(id, tenantId);
    this.assertValidDateRange(dto.startDate ?? entry.startDate, dto.targetDate ?? entry.targetDate);

    const previous = { ...entry };

    if (dto.projectId !== undefined && dto.projectId !== entry.projectId) {
      const project = await this.projectsService.findOne(dto.projectId, tenantId);
      entry.projectId = project.id;
      entry.projectName = project.name;
    }
    if (dto.moduleId !== undefined) entry.moduleId = dto.moduleId;
    if (dto.moduleName !== undefined) entry.moduleName = dto.moduleName;
    if (dto.phaseId !== undefined) entry.phaseId = dto.phaseId;
    if (dto.phaseName !== undefined) entry.phaseName = dto.phaseName;
    if (dto.teamId !== undefined) entry.teamId = dto.teamId;
    if (dto.teamName !== undefined) entry.teamName = dto.teamName;
    if (dto.startDate !== undefined) entry.startDate = dto.startDate;
    if (dto.targetDate !== undefined) entry.targetDate = dto.targetDate;

    const saved = await this.entriesRepository.save(entry);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.PROJECT_PLAN_UPDATED,
      tenantId,
      entityType: 'ProjectPlanEntry',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  async updateStatus(
    id: number,
    status: ProjectPlanStatus,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<ProjectPlanEntry> {
    const entry = await this.findOne(id, tenantId);
    const fromStatus = entry.status;
    entry.status = status;
    const saved = await this.entriesRepository.save(entry);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.PROJECT_PLAN_STATUS_CHANGED,
      tenantId,
      entityType: 'ProjectPlanEntry',
      entityId: saved.id,
      details: { from: fromStatus, to: status },
    });

    return saved;
  }

  async setActive(
    id: number,
    isActive: boolean,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<ProjectPlanEntry> {
    const entry = await this.findOne(id, tenantId);
    entry.isActive = isActive;
    const saved = await this.entriesRepository.save(entry);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: isActive ? AuditActions.PROJECT_PLAN_ACTIVATED : AuditActions.PROJECT_PLAN_DEACTIVATED,
      tenantId,
      entityType: 'ProjectPlanEntry',
      entityId: saved.id,
    });

    return saved;
  }
}
