import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { ProjectModule } from './project-module.entity';
import { Issue } from '../issues/issue.entity';
import { ProjectPlanEntry } from '../project-planning/project-plan-entry.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { Phase } from '../phases/phase.entity';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { ProjectsService } from '../projects/projects.service';
import { EventsGateway } from '../events/events.gateway';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface ProjectModuleWithCompletion extends ProjectModule {
  percentComplete: number | null;
  completedTaskCount: number;
  totalTaskCount: number;
}

export type RiskLevel = 'Low' | 'Medium' | 'High';

// The project/module drill-down rolls up Tasks (project_tasks), not the
// legacy Issues table - all real work lives in tasks, so an issues-based
// rollup showed every project as "Not Started 0%". Pass/Closed (and the
// post-Pass Released statuses) count as done; Junk is left out entirely.
const DONE_TASK_STATUSES = ['Pass', 'Closed', 'Released - No Showstoppers', 'Released - With Showstoppers'];
const EXCLUDED_TASK_STATUSES = ['Junk'];

export interface TaskDrillDown {
  id: number;
  title: string;
  status: string;
  riskLevel: RiskLevel;
  keyFocusArea: string;
  dueDate: string | null;
  assigneeEmail: string;
}

export interface GroupDrillDown {
  completionPercent: number;
  riskLevel: RiskLevel;
  keyFocusArea: string;
  status: string;
  taskCount: number;
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
    @InjectRepository(ProjectTask)
    private projectTasksRepository: Repository<ProjectTask>,
    @InjectRepository(Phase)
    private phasesRepository: Repository<Phase>,
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

  // %Complete per module from its tasks (project_tasks) - same rule as
  // the Project Overview: Pass/Closed/Released count as done, Junk is left
  // out of both counts. null (not 0) when the module has no counted tasks,
  // distinct from "has tasks but none done". One grouped query for all
  // modules rather than one query per module.
  async findAllWithCompletion(tenantId: number, projectId?: number): Promise<ProjectModuleWithCompletion[]> {
    const where: Record<string, unknown> = { tenantId };
    if (projectId != null) where.projectId = projectId;
    const modules = await this.modulesRepository.find({ where, order: { createdAt: 'DESC' } });
    if (modules.length === 0) return [];

    const rows: { moduleId: number; total: string; done: string }[] = await this.projectTasksRepository
      .createQueryBuilder('t')
      .select('t.moduleId', 'moduleId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE t.status IN (:...done))', 'done')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.moduleId IN (:...moduleIds)', { moduleIds: modules.map((m) => m.id) })
      .andWhere('t.status NOT IN (:...excluded)', { excluded: EXCLUDED_TASK_STATUSES })
      .setParameter('done', DONE_TASK_STATUSES)
      .groupBy('t.moduleId')
      .getRawMany();
    const countsByModuleId = new Map(rows.map((r) => [Number(r.moduleId), { total: Number(r.total), done: Number(r.done) }]));

    return modules.map((module) => {
      const counts = countsByModuleId.get(module.id);
      if (!counts || counts.total === 0) {
        return { ...module, percentComplete: null, completedTaskCount: 0, totalTaskCount: 0 };
      }
      const percentComplete = Math.round((counts.done / counts.total) * 100);
      return { ...module, percentComplete, completedTaskCount: counts.done, totalTaskCount: counts.total };
    });
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

    // Keep every denormalized copy of the module name in sync, same as
    // Sprint does for its own name changes - Issue, ProjectTask (Task
    // Backlog/My Tasks/Team Tasks all display moduleName), and
    // ProjectPlanEntry (Project Planning) each keep their own snapshot
    // rather than a live join. (Phase's own rename got this same fix -
    // see PhasesService.update() - Module had the identical gap.)
    if (dto.name !== undefined) {
      await this.issuesRepository.update({ moduleId: id, tenantId }, { moduleName: saved.name });
      await this.projectTasksRepository.update({ moduleId: id, tenantId }, { moduleName: saved.name });
      await this.projectPlanEntriesRepository.update({ moduleId: id, tenantId }, { moduleName: saved.name });
      await this.phasesRepository.update({ moduleId: id, tenantId }, { moduleName: saved.name });
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

  private isTaskDone(task: ProjectTask): boolean {
    return DONE_TASK_STATUSES.includes(task.status);
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // Escalated = High (the task-world equivalent of a showstopper issue);
  // Failed or open past its due date = Medium; everything else Low.
  private taskRiskLevel(task: ProjectTask, today: string): RiskLevel {
    if (this.isTaskDone(task)) return 'Low';
    if (task.status === 'Escalated') return 'High';
    if (task.status === 'Failed') return 'Medium';
    if (task.dueDate && String(task.dueDate).slice(0, 10) < today) return 'Medium';
    return 'Low';
  }

  private taskKeyFocusArea(task: ProjectTask): string {
    return task.phaseName || 'No phase';
  }

  private toTaskDrillDown(task: ProjectTask, today: string): TaskDrillDown {
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      riskLevel: this.taskRiskLevel(task, today),
      keyFocusArea: this.taskKeyFocusArea(task),
      dueDate: task.dueDate ? String(task.dueDate).slice(0, 10) : null,
      assigneeEmail: task.assigneeEmail,
    };
  }

  private findCountedTasks(where: { projectId?: number; moduleId?: number; tenantId: number }) {
    return this.projectTasksRepository.find({
      where: { ...where, status: Not(In(EXCLUDED_TASK_STATUSES)) },
      order: { createdAt: 'ASC' },
    });
  }

  // Rolls a group of tasks (a module's, or a whole project's) up into one
  // summary. Completion % is done/total (Junk excluded from both). Risk
  // rolls up as the worst level present. Key focus area is the most common
  // phase among the still-open tasks (ties broken alphabetically).
  private summarize(tasks: ProjectTask[]): GroupDrillDown {
    const taskCount = tasks.length;
    if (taskCount === 0) {
      return { completionPercent: 0, riskLevel: 'Low', keyFocusArea: 'None', status: 'Not Started', taskCount: 0 };
    }

    const today = this.todayIso();
    const completed = tasks.filter((t) => this.isTaskDone(t)).length;
    const completionPercent = Math.round((completed / taskCount) * 100);

    const risks = tasks.map((t) => this.taskRiskLevel(t, today));
    const riskLevel: RiskLevel = risks.includes('High') ? 'High' : risks.includes('Medium') ? 'Medium' : 'Low';

    const openTasks = tasks.filter((t) => !this.isTaskDone(t));
    const focusPool = openTasks.length > 0 ? openTasks : tasks;
    const focusCounts = new Map<string, number>();
    for (const task of focusPool) {
      const key = this.taskKeyFocusArea(task);
      focusCounts.set(key, (focusCounts.get(key) || 0) + 1);
    }
    const keyFocusArea = Array.from(focusCounts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0][0];

    const status =
      completionPercent === 100 ? 'Completed' : riskLevel === 'High' ? 'At Risk' : 'In Progress';

    return { completionPercent, riskLevel, keyFocusArea, status, taskCount };
  }

  // Level 1 + 2 of the drill-down: overall project rollup, plus each
  // module's own rollup. Deliberately doesn't include individual tasks -
  // those are fetched separately (getModuleOverview) only when a module
  // is expanded, so this stays a light payload.
  async getProjectOverview(projectId: number, tenantId: number) {
    const project = await this.projectsService.findOne(projectId, tenantId);
    const [modules, tasks] = await Promise.all([
      this.findAllForProject(projectId, tenantId, { includeInactive: true }),
      this.findCountedTasks({ projectId, tenantId }),
    ]);

    const tasksByModuleId = new Map<number, ProjectTask[]>();
    const unassignedTasks: ProjectTask[] = [];
    for (const task of tasks) {
      if (task.moduleId == null) {
        unassignedTasks.push(task);
        continue;
      }
      if (!tasksByModuleId.has(task.moduleId)) tasksByModuleId.set(task.moduleId, []);
      tasksByModuleId.get(task.moduleId).push(task);
    }

    const moduleRows = modules.map((module) => ({
      id: module.id,
      name: module.name,
      isActive: module.isActive,
      description: module.description,
      ...this.summarize(tasksByModuleId.get(module.id) || []),
    }));

    // Tasks with no module (or a module not on this project) still count
    // toward the project totals and show under a synthetic "Unassigned"
    // bucket - id: null, not a real Module row.
    const knownModuleIds = new Set(modules.map((m) => m.id));
    for (const [moduleId, moduleTasks] of tasksByModuleId) {
      if (!knownModuleIds.has(moduleId)) unassignedTasks.push(...moduleTasks);
    }
    if (unassignedTasks.length > 0) {
      moduleRows.push({
        id: null,
        name: 'Unassigned',
        isActive: true,
        description: null,
        ...this.summarize(unassignedTasks),
      });
    }

    return {
      project: { id: project.id, name: project.name, description: project.description },
      ...this.summarize(tasks),
      modules: moduleRows,
    };
  }

  // Level 3: one module's tasks, each with their own risk.
  async getModuleOverview(moduleId: number, tenantId: number) {
    const module = await this.findOne(moduleId, tenantId);
    const tasks = await this.findCountedTasks({ moduleId, tenantId });
    const today = this.todayIso();

    return {
      module: { id: module.id, name: module.name, description: module.description, projectId: module.projectId },
      ...this.summarize(tasks),
      tasks: tasks.map((t) => this.toTaskDrillDown(t, today)),
    };
  }

  // Same synthetic "Unassigned" bucket as getProjectOverview, exposed as
  // its own lookup so the frontend can drill into it exactly like a real
  // module (moduleId: null in the URL).
  async getUnassignedOverview(projectId: number, tenantId: number) {
    await this.projectsService.findOne(projectId, tenantId);
    const [modules, tasks] = await Promise.all([
      this.findAllForProject(projectId, tenantId, { includeInactive: true }),
      this.findCountedTasks({ projectId, tenantId }),
    ]);
    const knownModuleIds = new Set(modules.map((m) => m.id));
    const unassigned = tasks.filter((t) => t.moduleId == null || !knownModuleIds.has(t.moduleId));
    const today = this.todayIso();

    return {
      module: { id: null, name: 'Unassigned', description: null, projectId },
      ...this.summarize(unassigned),
      tasks: unassigned.map((t) => this.toTaskDrillDown(t, today)),
    };
  }
}
