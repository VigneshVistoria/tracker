import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Phase } from './phase.entity';
import { Issue, IssueStatus } from '../issues/issue.entity';
import { ProjectPlanEntry } from '../project-planning/project-plan-entry.entity';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';
import { ModulesService } from '../modules/modules.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface PhaseWithCompletion extends Phase {
  percentComplete: number | null;
  completedIssueCount: number;
  totalIssueCount: number;
}

@Injectable()
export class PhasesService {
  constructor(
    @InjectRepository(Phase)
    private phasesRepository: Repository<Phase>,
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    @InjectRepository(ProjectPlanEntry)
    private projectPlanEntriesRepository: Repository<ProjectPlanEntry>,
    private modulesService: ModulesService,
    private auditLogService: AuditLogService,
  ) {}

  findAllForModule(
    moduleId: number,
    tenantId: number,
    options: { includeInactive?: boolean } = {},
  ): Promise<Phase[]> {
    const where: Record<string, unknown> = { moduleId, tenantId };
    if (!options.includeInactive) where.isActive = true;
    return this.phasesRepository.find({ where, order: { createdAt: 'ASC' } });
  }

  async findOne(id: number, tenantId: number): Promise<Phase> {
    const phase = await this.phasesRepository.findOne({ where: { id, tenantId } });
    if (!phase) {
      throw new NotFoundException(`Phase #${id} not found`);
    }
    return phase;
  }

  private async assertNameAvailable(moduleId: number, name: string, tenantId: number, excludeId?: number): Promise<void> {
    const existing = await this.phasesRepository.findOne({ where: { moduleId, name, tenantId } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`A phase named "${name}" already exists in this module.`);
    }
  }

  private async computeCompletion(phase: Phase): Promise<PhaseWithCompletion> {
    const issues = await this.issuesRepository.find({ where: { phaseId: phase.id, tenantId: phase.tenantId } });
    const totalIssueCount = issues.length;
    if (totalIssueCount === 0) {
      return { ...phase, percentComplete: null, completedIssueCount: 0, totalIssueCount: 0 };
    }
    const completedIssueCount = issues.filter((i) => i.status === IssueStatus.READY_FOR_PRODUCTION).length;
    const percentComplete = Math.round((completedIssueCount / totalIssueCount) * 100);
    return { ...phase, percentComplete, completedIssueCount, totalIssueCount };
  }

  async findAllWithCompletion(
    tenantId: number,
    filters: { projectId?: number; moduleId?: number } = {},
  ): Promise<PhaseWithCompletion[]> {
    const where: Record<string, unknown> = { tenantId };
    if (filters.projectId != null) where.projectId = filters.projectId;
    if (filters.moduleId != null) where.moduleId = filters.moduleId;
    const phases = await this.phasesRepository.find({ where, order: { createdAt: 'DESC' } });
    return Promise.all(phases.map((p) => this.computeCompletion(p)));
  }

  async create(dto: CreatePhaseDto, user: { id: number; email: string }, tenantId: number): Promise<Phase> {
    const module = await this.modulesService.findOne(dto.moduleId, tenantId);
    await this.assertNameAvailable(module.id, dto.name, tenantId);

    const phase = this.phasesRepository.create({
      projectId: module.projectId,
      projectName: module.projectName,
      moduleId: module.id,
      moduleName: module.name,
      name: dto.name,
      createdByUserId: user.id,
      tenantId,
    });
    const saved = await this.phasesRepository.save(phase);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.PHASE_CREATED,
      tenantId,
      entityType: 'Phase',
      entityId: saved.id,
      details: { moduleId: saved.moduleId, name: saved.name },
    });

    return saved;
  }

  async update(
    id: number,
    dto: UpdatePhaseDto,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<Phase> {
    const phase = await this.findOne(id, tenantId);
    if (dto.name !== undefined && dto.name !== phase.name) {
      await this.assertNameAvailable(phase.moduleId, dto.name, tenantId, id);
    }
    const previous = { ...phase };

    if (dto.name !== undefined) phase.name = dto.name;

    const saved = await this.phasesRepository.save(phase);

    // Keep the denormalized phase name on every issue in this phase in
    // sync, same as Module does for its own name changes.
    if (dto.name !== undefined) {
      await this.issuesRepository.update({ phaseId: id, tenantId }, { phaseName: saved.name });
    }

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.PHASE_UPDATED,
      tenantId,
      entityType: 'Phase',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  async setActive(
    id: number,
    isActive: boolean,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<Phase> {
    const phase = await this.findOne(id, tenantId);
    phase.isActive = isActive;
    const saved = await this.phasesRepository.save(phase);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: isActive ? AuditActions.PHASE_ACTIVATED : AuditActions.PHASE_DEACTIVATED,
      tenantId,
      entityType: 'Phase',
      entityId: saved.id,
    });

    return saved;
  }

  async remove(id: number, user: { id: number; email: string }, tenantId: number): Promise<void> {
    const phase = await this.findOne(id, tenantId);

    const [linkedIssueCount, linkedPlanEntryCount] = await Promise.all([
      this.issuesRepository.count({ where: { phaseId: id, tenantId } }),
      this.projectPlanEntriesRepository.count({ where: { phaseId: id, tenantId } }),
    ]);
    if (linkedIssueCount > 0 || linkedPlanEntryCount > 0) {
      throw new ConflictException(
        `Can't delete "${phase.name}" - it's referenced by ${linkedIssueCount} issue(s) and ${linkedPlanEntryCount} Project Planning entr${linkedPlanEntryCount === 1 ? 'y' : 'ies'}. Deactivate it instead.`,
      );
    }

    await this.phasesRepository.delete(id);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.PHASE_DELETED,
      tenantId,
      entityType: 'Phase',
      entityId: id,
      details: { deleted: phase },
    });
  }
}
