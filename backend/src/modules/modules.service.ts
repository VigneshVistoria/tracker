import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectModule } from './project-module.entity';
import { Issue, IssueStatus, IssueCategory } from '../issues/issue.entity';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { ProjectsService } from '../projects/projects.service';
import { EventsGateway } from '../events/events.gateway';

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
    private projectsService: ProjectsService,
    private eventsGateway: EventsGateway,
  ) {}

  findAllForProject(projectId: number): Promise<ProjectModule[]> {
    return this.modulesRepository.find({ where: { projectId }, order: { createdAt: 'ASC' } });
  }

  async findOne(id: number): Promise<ProjectModule> {
    const module = await this.modulesRepository.findOne({ where: { id } });
    if (!module) {
      throw new NotFoundException(`Module #${id} not found`);
    }
    return module;
  }

  async create(dto: CreateModuleDto, userId: number): Promise<ProjectModule> {
    const project = await this.projectsService.findOne(dto.projectId);
    const module = this.modulesRepository.create({
      projectId: project.id,
      projectName: project.name,
      name: dto.name,
      description: dto.description,
      createdByUserId: userId,
    });
    const saved = await this.modulesRepository.save(module);
    this.eventsGateway.emitModuleCreated(saved);
    return saved;
  }

  async update(id: number, dto: UpdateModuleDto): Promise<ProjectModule> {
    const module = await this.findOne(id);
    if (dto.name !== undefined) module.name = dto.name;
    if (dto.description !== undefined) module.description = dto.description;

    const saved = await this.modulesRepository.save(module);

    // Keep the denormalized module name on every issue in this module in
    // sync, same as Sprint does for its own name changes.
    if (dto.name !== undefined) {
      await this.issuesRepository.update({ moduleId: id }, { moduleName: saved.name });
    }

    this.eventsGateway.emitModuleUpdated(saved);
    return saved;
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    // Unassign rather than orphan - same as Sprint.remove().
    await this.issuesRepository.update({ moduleId: id }, { moduleId: null, moduleName: null });
    await this.modulesRepository.delete(id);
    this.eventsGateway.emitModuleDeleted(id);
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
  async getProjectOverview(projectId: number) {
    const project = await this.projectsService.findOne(projectId);
    const [modules, issues] = await Promise.all([
      this.findAllForProject(projectId),
      this.issuesRepository.find({ where: { projectId } }),
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
  async getModuleOverview(moduleId: number) {
    const module = await this.findOne(moduleId);
    const issues = await this.issuesRepository.find({ where: { moduleId }, order: { createdAt: 'ASC' } });

    return {
      module: { id: module.id, name: module.name, description: module.description, projectId: module.projectId },
      ...this.summarize(issues),
      issues: issues.map((i) => this.toIssueDrillDown(i)),
    };
  }

  // Same synthetic "Unassigned" bucket as getProjectOverview, exposed as
  // its own lookup so the frontend can drill into it exactly like a real
  // module (moduleId: null in the URL).
  async getUnassignedOverview(projectId: number) {
    await this.projectsService.findOne(projectId);
    const issues = await this.issuesRepository.find({
      where: { projectId },
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
