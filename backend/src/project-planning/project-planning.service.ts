import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectPlanEntry, ProjectPlanStatus } from './project-plan-entry.entity';
import { CreateProjectPlanEntryDto } from './dto/create-project-plan-entry.dto';
import { UpdateProjectPlanEntryDto } from './dto/update-project-plan-entry.dto';
import { Issue, IssueStatus } from '../issues/issue.entity';
import { ProjectsService } from '../projects/projects.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface ProjectPlanEntryWithCompletion extends ProjectPlanEntry {
  percentComplete: number | null;
  completedIssueCount: number;
  totalIssueCount: number;
}

@Injectable()
export class ProjectPlanningService {
  constructor(
    @InjectRepository(ProjectPlanEntry)
    private entriesRepository: Repository<ProjectPlanEntry>,
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    private projectsService: ProjectsService,
    private auditLogService: AuditLogService,
  ) {}

  private assertValidDateRange(startDate: string, targetDate: string): void {
    if (targetDate < startDate) {
      throw new BadRequestException('Target Date must be on or after Start Date.');
    }
  }

  // Completion is never stored - always computed live from the real
  // Issues in scope, mirroring ModulesService.summarize()'s exact
  // completed/total ratio. Scope is Project (always) + Module/Phase if set
  // on the entry - Team is never part of the scope, Issue has no teamId to
  // filter by. totalIssueCount === 0 -> percentComplete: null, distinct
  // from "0% done" (which means work exists but none is done).
  private async computeCompletion(entry: ProjectPlanEntry): Promise<ProjectPlanEntryWithCompletion> {
    const where: Record<string, unknown> = { projectId: entry.projectId, tenantId: entry.tenantId };
    if (entry.moduleId != null) where.moduleId = entry.moduleId;
    if (entry.phaseId != null) where.phaseId = entry.phaseId;

    const issues = await this.issuesRepository.find({ where });
    const totalIssueCount = issues.length;

    if (totalIssueCount === 0) {
      return { ...entry, percentComplete: null, completedIssueCount: 0, totalIssueCount: 0 };
    }

    const completedIssueCount = issues.filter((i) => i.status === IssueStatus.READY_FOR_PRODUCTION).length;
    const percentComplete = Math.round((completedIssueCount / totalIssueCount) * 100);

    return { ...entry, percentComplete, completedIssueCount, totalIssueCount };
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
