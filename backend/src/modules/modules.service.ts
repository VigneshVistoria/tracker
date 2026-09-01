import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectModule } from './project-module.entity';
import { Issue, IssueStatus, IssueCategory } from '../issues/issue.entity';
import { ProjectPlanEntry } from '../project-planning/project-plan-entry.entity';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { ProjectsService } from '../projects/projects.service';
import { EventsGateway } from '../events/events.gateway';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface ProjectModuleWithCompletion extends ProjectModule {
  percentComplete: number | null;
  completedIssueCount: number;
  totalIssueCount: number;
}

export type RiskLevel = 'Low' | 'Medium' | 'High';

// Same "no status change in N days" staleness window the Weekly Report
// uses to flag a risk item - kept as its own constant here rather than
// imported, since WeeklyReportsService doesn't export it and the two
// features are independent (same reasoning as this app's other
// self-contained per-service calculations, e.g. STATUS_HEALTH_WEIGHT).
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// How far along each status is, for a single issue's "% complete" -
// distinct from the Weekly Report's completion % (which is a binary
// done/not-done ratio across many issues). Backlog/QA Failed share a
// value since QA Failed is a regression back to "still needs work", not
// further along than a fresh Backlog item.
const ISSUE_PROGRESS_PERCENT: Record<IssueStatus, number> = {
  [IssueStatus.BACKLOG]: 0,
  [IssueStatus.IN_PROGRESS]: 40,
  [IssueStatus.IN_REVIEW]: 70,
  [IssueStatus.QA_TESTING]: 85,
  [IssueStatus.QA_FAILED]: 40,
  [IssueStatus.READY_FOR_PRODUCTION]: 100,
};

export interface IssueDrillDown {
  id: number;
  title: string;
  status: IssueStatus;
  completionPercent: number;
  riskLevel: RiskLevel;
  keyFocusArea: string;
  assigneeEmail: string;
}

export interface GroupDrillDown {
  completionPercent: number;
  riskLevel: RiskLevel;
  keyFocusArea: string;
  status: string;
  issueCount: number;
}

@Injectable()
export class ModulesService {
  constructor(
    @InjectRepository(ProjectModule)
    private modulesRepository: Repository<ProjectModule>,
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    @InjectRepository(ProjectPlanEntry)
    private projectPlanEntriesRepository: Repository<ProjectPlanEntry>,
    private projectsService: ProjectsService,
    private eventsGateway: EventsGateway,
    private auditLogService: AuditLogService,
  ) {}

  // Dropdowns that let someone assign an issue/plan entry TO a module
  // (Issue edit form, Project Planning's Module field) call this with no
  // options - only active modules should be offered going forward. The
  // project/module drill-down (getProjectOverview/getModuleOverview)
  // needs full history including deactivated modules, so it explicitly
  // passes includeInactive: true.
  findAllForProject(
    projectId: number,
    tenantId: number,
    options: { includeInactive?: boolean } = {},
  ): Promise<ProjectModule[]> {
    const where: Record<string, unknown> = { projectId, tenantId };
    if (!options.includeInactive) where.isActive = true;
    return this.modulesRepository.find({ where, order: { createdAt: 'ASC' } });
  }

  async findOne(id: number, tenantId: number): Promise<ProjectModule> {
    const module = await this.modulesRepository.findOne({ where: { id, tenantId } });
    if (!module) {
      throw new NotFoundException(`Module #${id} not found`);
    }
    return module;
  }

  private async assertNameAvailable(projectId: number, name: string, tenantId: number, excludeId?: number): Promise<void> {
    const existing = await this.modulesRepository.findOne({ where: { projectId, name, tenantId } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`A module named "${name}" already exists in this project.`);
    }
  }

  // Same completed/total ratio ModulesService.summarize() already uses
  // for the drill-down, and the identical convention
  // ProjectPlanningService.computeCompletion() uses - null (not 0) when
  // no issues are linked yet, distinct from "linked but none done".
  private async computeCompletion(module: ProjectModule): Promise<ProjectModuleWithCompletion> {
    const issues = await this.issuesRepository.find({ where: { moduleId: module.id, tenantId: module.tenantId } });
    const totalIssueCount = issues.length;
    if (totalIssueCount === 0) {
      return { ...module, percentComplete: null, completedIssueCount: 0, totalIssueCount: 0 };
    }
    const completedIssueCount = issues.filter((i) => i.status === IssueStatus.READY_FOR_PRODUCTION).length;
    const percentComplete = Math.round((completedIssueCount / totalIssueCount) * 100);
    return { ...module, percentComplete, completedIssueCount, totalIssueCount };
  }

  // Tenant-wide (or project-filtered) list with %Complete attached -
  // powers the Project Modules page. Includes inactive modules (shown
  // with a status badge there), unlike findAllForProject's default.
  async findAllWithCompletion(tenantId: number, projectId?: number): Promise<ProjectModuleWithCompletion[]> {
    const where: Record<string, unknown> = { tenantId };
    if (projectId != null) where.projectId = projectId;
    const modules = await this.modulesRepository.find({ where, order: { createdAt: 'DESC' } });
    return Promise.all(modules.map((m) => this.computeCompletion(m)));
  }

  async create(
    dto: CreateModuleDto,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<ProjectModule> {
    const project = await this.projectsService.findOne(dto.projectId, tenantId);
    await this.assertNameAvailable(project.id, dto.name, tenantId);

    const module = this.modulesRepository.create({
      projectId: project.id,
      projectName: project.name,
      name: dto.name,
      description: dto.description,
      createdByUserId: user.id,
      tenantId,
    });
    const saved = await this.modulesRepository.save(module);
    this.eventsGateway.emitModuleCreated(saved);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.MODULE_CREATED,
      tenantId,
      entityType: 'ProjectModule',
      entityId: saved.id,
      details: { projectId: saved.projectId, name: saved.name },
    });

    return saved;
  }

  async update(
    id: number,
    dto: UpdateModuleDto,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<ProjectModule> {
    const module = await this.findOne(id, tenantId);
    if (dto.name !== undefined && dto.name !== module.name) {
      await this.assertNameAvailable(module.projectId, dto.name, tenantId, id);
    }
    const previous = { ...module };

    if (dto.name !== undefined) module.name = dto.name;
    if (dto.description !== undefined) module.description = dto.description;

    const saved = await this.modulesRepository.save(module);

    // Keep the denormalized module name on every issue in this module in
    // sync, same as Sprint does for its own name changes.
    if (dto.name !== undefined) {
      await this.issuesRepository.update({ moduleId: id, tenantId }, { moduleName: saved.name });
    }

    this.eventsGateway.emitModuleUpdated(saved);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.MODULE_UPDATED,
      tenantId,
      entityType: 'ProjectModule',
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
  ): Promise<ProjectModule> {
    const module = await this.findOne(id, tenantId);
    module.isActive = isActive;
    const saved = await this.modulesRepository.save(module);
    this.eventsGateway.emitModuleUpdated(saved);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: isActive ? AuditActions.MODULE_ACTIVATED : AuditActions.MODULE_DEACTIVATED,
      tenantId,
      entityType: 'ProjectModule',
      entityId: saved.id,
    });

    return saved;
  }

  async remove(id: number, user: { id: number; email: string }, tenantId: number): Promise<void> {
    const module = await this.findOne(id, tenantId);

    const [linkedIssueCount, linkedPlanEntryCount] = await Promise.all([
      this.issuesRepository.count({ where: { moduleId: id, tenantId } }),
      this.projectPlanEntriesRepository.count({ where: { moduleId: id, tenantId } }),
    ]);
    if (linkedIssueCount > 0 || linkedPlanEntryCount > 0) {
      throw new ConflictException(
        `Can't delete "${module.name}" - it's referenced by ${linkedIssueCount} issue(s) and ${linkedPlanEntryCount} Project Planning entr${linkedPlanEntryCount === 1 ? 'y' : 'ies'}. Deactivate it instead.`,
      );
    }

    await this.modulesRepository.delete(id);
    this.eventsGateway.emitModuleDeleted(id, tenantId);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.MODULE_DELETED,
      tenantId,
      entityType: 'ProjectModule',
      entityId: id,
      details: { deleted: module },
    });
  }

  // --- Drill-down: project -> module -> issue ---

  private issueProgressPercent(issue: Issue): number {
    return ISSUE_PROGRESS_PERCENT[issue.status] ?? 0;
  }

  private issueRiskLevel(issue: Issue): RiskLevel {
    const isHighRiskCategory =
      issue.category === IssueCategory.CRITICAL || issue.category === IssueCategory.SHOWSTOPPER;
    if (issue.showstopper || isHighRiskCategory) {
      return 'High';
    }
    const isStale = Date.now() - new Date(issue.updatedAt).getTime() >= STALE_AFTER_MS;
    const isOpen = issue.status !== IssueStatus.READY_FOR_PRODUCTION;
    if (isOpen && isStale) {
      return 'Medium';
    }
    if (issue.status === IssueStatus.QA_FAILED) {
      return 'Medium';
    }
    return 'Low';
  }

  private issueKeyFocusArea(issue: Issue): string {
    return issue.category || 'Uncategorized';
  }

  private toIssueDrillDown(issue: Issue): IssueDrillDown {
    return {
      id: issue.id,
      title: issue.title,
      status: issue.status,
      completionPercent: this.issueProgressPercent(issue),
      riskLevel: this.issueRiskLevel(issue),
      keyFocusArea: this.issueKeyFocusArea(issue),
      assigneeEmail: issue.assigneeEmail,
    };
  }

  // Rolls a group of issues (a module's issues, or a whole project's) up
  // into one summary. Completion % is completed/total, the same ratio the
  // Weekly Report uses at the org-wide level - not an average of each
  // issue's individual progress %, so a project isn't "70% done" just
  // because everything is in-flight at 70%. Risk rolls up as the worst
  // level present. Key focus area is the most common category among the
  // still-open issues (ties broken alphabetically for a stable result).
  private summarize(issues: Issue[]): GroupDrillDown {
    const issueCount = issues.length;
    if (issueCount === 0) {
      return { completionPercent: 0, riskLevel: 'Low', keyFocusArea: 'None', status: 'Not Started', issueCount: 0 };
    }

    const completed = issues.filter((i) => i.status === IssueStatus.READY_FOR_PRODUCTION).length;
    const completionPercent = Math.round((completed / issueCount) * 100);

    const risks = issues.map((i) => this.issueRiskLevel(i));
    const riskLevel: RiskLevel = risks.includes('High') ? 'High' : risks.includes('Medium') ? 'Medium' : 'Low';

    const openIssues = issues.filter((i) => i.status !== IssueStatus.READY_FOR_PRODUCTION);
    const focusPool = openIssues.length > 0 ? openIssues : issues;
    const categoryCounts = new Map<string, number>();
    for (const issue of focusPool) {
      const key = this.issueKeyFocusArea(issue);
      categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
    }
    const keyFocusArea = Array.from(categoryCounts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0][0];

    const status =
      completionPercent === 100 ? 'Completed' : riskLevel === 'High' ? 'At Risk' : 'In Progress';

    return { completionPercent, riskLevel, keyFocusArea, status, issueCount };
  }

  // Level 1 + 2 of the drill-down: overall project rollup, plus each
  // module's own rollup. Deliberately doesn't include individual issues -
  // those are fetched separately (getModuleOverview) only when a module
  // is expanded, so this stays a light payload.
  async getProjectOverview(projectId: number, tenantId: number) {
    const project = await this.projectsService.findOne(projectId, tenantId);
    const [modules, issues] = await Promise.all([
      this.findAllForProject(projectId, tenantId, { includeInactive: true }),
      this.issuesRepository.find({ where: { projectId, tenantId } }),
    ]);

    const issuesByModuleId = new Map<number, Issue[]>();
    const unassignedIssues: Issue[] = [];
    for (const issue of issues) {
      if (issue.moduleId == null) {
        unassignedIssues.push(issue);
        continue;
      }
      if (!issuesByModuleId.has(issue.moduleId)) issuesByModuleId.set(issue.moduleId, []);
      issuesByModuleId.get(issue.moduleId).push(issue);
    }

    const moduleRows = modules.map((module) => ({
      id: module.id,
      name: module.name,
      isActive: module.isActive,
      description: module.description,
      ...this.summarize(issuesByModuleId.get(module.id) || []),
    }));

    // Issues not yet grouped into a module still count toward the
    // project's own totals (computed from `issues` below), and still show
    // up in the drill-down under a synthetic "Unassigned" bucket - not a
    // real Module row, just id: null, so existing data with no modules
    // set up yet still displays sensibly.
    if (unassignedIssues.length > 0) {
      moduleRows.push({
        id: null,
        name: 'Unassigned',
        isActive: true,
        description: null,
        ...this.summarize(unassignedIssues),
      });
    }

    return {
      project: { id: project.id, name: project.name, description: project.description },
      ...this.summarize(issues),
      modules: moduleRows,
    };
  }

  // Level 3: one module's issues, each with their own rollup.
  async getModuleOverview(moduleId: number, tenantId: number) {
    const module = await this.findOne(moduleId, tenantId);
    const issues = await this.issuesRepository.find({ where: { moduleId, tenantId }, order: { createdAt: 'ASC' } });

    return {
      module: { id: module.id, name: module.name, description: module.description, projectId: module.projectId },
      ...this.summarize(issues),
      issues: issues.map((i) => this.toIssueDrillDown(i)),
    };
  }

  // Same synthetic "Unassigned" bucket as getProjectOverview, exposed as
  // its own lookup so the frontend can drill into it exactly like a real
  // module (moduleId: null in the URL).
  async getUnassignedOverview(projectId: number, tenantId: number) {
    await this.projectsService.findOne(projectId, tenantId);
    const issues = await this.issuesRepository.find({
      where: { projectId, tenantId },
      order: { createdAt: 'ASC' },
    });
    const unassigned = issues.filter((i) => i.moduleId == null);

    return {
      module: { id: null, name: 'Unassigned', description: null, projectId },
      ...this.summarize(unassigned),
      issues: unassigned.map((i) => this.toIssueDrillDown(i)),
    };
  }
}
