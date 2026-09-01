import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ProjectsService } from '../projects/projects.service';
import { ModulesService } from '../modules/modules.service';
import { PhasesService } from '../phases/phases.service';
import { SprintsService } from '../sprints/sprints.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { TaskStatusConfigService } from '../task-status-config/task-status-config.service';
import { TaskStatus } from '../task-status-config/task-status-percent.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface ProjectTaskWithComputed extends ProjectTask {
  percentComplete: number | null;
  ageingDays: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    private projectsService: ProjectsService,
    private modulesService: ModulesService,
    private phasesService: PhasesService,
    private sprintsService: SprintsService,
    private usersService: UsersService,
    private taskStatusConfigService: TaskStatusConfigService,
    private auditLogService: AuditLogService,
  ) {}

  canView(task: ProjectTask, user: { id: number; role: UserRole }): boolean {
    if (user.role === UserRole.ADMIN || user.role === UserRole.EXECUTIVE || user.role === UserRole.PROGRAM_MANAGER) {
      return true;
    }
    return task.assigneeUserId === user.id || task.createdByUserId === user.id;
  }

  canEdit(task: ProjectTask, user: { id: number; role: UserRole }): boolean {
    if (user.role === UserRole.ADMIN || user.role === UserRole.PROGRAM_MANAGER) {
      return true;
    }
    return task.assigneeUserId === user.id;
  }

  // Validates the full Project -> Module -> Phase -> Sprint chain against
  // each other, resolving the denormalized name fields server-side - same
  // pattern as IssuesService.update()'s moduleId/phaseId checks, extended
  // one level further to include Project and Sprint.
  private async resolveChain(projectId: number, moduleId: number, phaseId: number, sprintId: number, tenantId: number) {
    const project = await this.projectsService.findOne(projectId, tenantId);
    const module = await this.modulesService.findOne(moduleId, tenantId);
    if (module.projectId !== project.id) {
      throw new BadRequestException(`Module #${moduleId} belongs to a different project.`);
    }
    const phase = await this.phasesService.findOne(phaseId, tenantId);
    if (phase.moduleId !== module.id) {
      throw new BadRequestException(`Phase #${phaseId} belongs to a different module.`);
    }
    const sprint = await this.sprintsService.findOne(sprintId, tenantId);
    if (sprint.projectId !== project.id) {
      throw new BadRequestException(`Sprint #${sprintId} belongs to a different project.`);
    }
    return { project, module, phase, sprint };
  }

  private async resolveDependencyOwner(dependencyOwnerUserId: number | undefined, tenantId: number) {
    if (dependencyOwnerUserId == null) return null;
    const owner = await this.usersService.findByIdAndTenant(dependencyOwnerUserId, tenantId);
    if (!owner) {
      throw new NotFoundException(`User #${dependencyOwnerUserId} not found`);
    }
    if (owner.role !== UserRole.DEVELOPER) {
      throw new BadRequestException('Dependency Owner must be a Developer.');
    }
    return owner;
  }

  private assertDependencyFieldsValid(dependency: boolean, description: string | undefined, ownerUserId: number | undefined): void {
    if (dependency && !description) {
      throw new BadRequestException('Dependency Description is required when Dependency is Yes.');
    }
    if (dependency && ownerUserId == null) {
      throw new BadRequestException('Dependency Owner is required when Dependency is Yes.');
    }
  }

  // Status can't be visible or settable until both fields exist - checked
  // against the values that WILL be true after this change is applied
  // (either just-supplied or already-stored).
  private assertStatusUnlockable(estimatedHours: number | null, dueDate: string | null): void {
    if (estimatedHours == null || dueDate == null) {
      throw new BadRequestException('Set Estimated Hours and Due Date before Status can be changed.');
    }
  }

  private async withComputedFields(task: ProjectTask, tenantId: number, percentByStatus?: Record<string, number>): Promise<ProjectTaskWithComputed> {
    const map = percentByStatus ?? (await this.taskStatusConfigService.percentByStatus(tenantId));
    const percentComplete = task.status != null ? map[task.status] ?? null : null;
    const ageingDays = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / MS_PER_DAY);
    return { ...task, percentComplete, ageingDays };
  }

  async findAllForUser(currentUser: { id: number; role: UserRole }, tenantId: number): Promise<ProjectTaskWithComputed[]> {
    const isLeadership = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.PROGRAM_MANAGER].includes(currentUser.role);
    const tasks = isLeadership
      ? await this.tasksRepository.find({ where: { tenantId }, order: { createdAt: 'DESC' } })
      : await this.tasksRepository.find({ where: { tenantId }, order: { createdAt: 'DESC' } }).then((all) =>
          all.filter((t) => t.assigneeUserId === currentUser.id || t.createdByUserId === currentUser.id),
        );

    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    return Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));
  }

  async findOne(id: number, tenantId: number): Promise<ProjectTask> {
    const task = await this.tasksRepository.findOne({ where: { id, tenantId } });
    if (!task) {
      throw new NotFoundException(`Task #${id} not found`);
    }
    return task;
  }

  async findOneWithComputed(id: number, tenantId: number): Promise<ProjectTaskWithComputed> {
    const task = await this.findOne(id, tenantId);
    return this.withComputedFields(task, tenantId);
  }

  async create(dto: CreateTaskDto, user: { id: number; email: string }, tenantId: number): Promise<ProjectTask> {
    const { project, module, phase, sprint } = await this.resolveChain(dto.projectId, dto.moduleId, dto.phaseId, dto.sprintId, tenantId);

    const assignee = await this.usersService.findByIdAndTenant(dto.assigneeUserId, tenantId);
    if (!assignee) {
      throw new NotFoundException(`User #${dto.assigneeUserId} not found`);
    }

    const dependency = dto.dependency ?? false;
    this.assertDependencyFieldsValid(dependency, dto.dependencyDescription, dto.dependencyOwnerUserId);
    const dependencyOwner = dependency ? await this.resolveDependencyOwner(dto.dependencyOwnerUserId, tenantId) : null;

    if (dto.status !== undefined) {
      this.assertStatusUnlockable(dto.estimatedHours ?? null, dto.dueDate ?? null);
    }

    const task = this.tasksRepository.create({
      projectId: project.id,
      projectName: project.name,
      moduleId: module.id,
      moduleName: module.name,
      phaseId: phase.id,
      phaseName: phase.name,
      sprintId: sprint.id,
      sprintName: sprint.name,
      description: dto.description,
      assigneeUserId: assignee.id,
      assigneeEmail: assignee.email,
      estimatedHours: dto.estimatedHours ?? null,
      dueDate: dto.dueDate ?? null,
      dependency,
      dependencyDescription: dependency ? dto.dependencyDescription : null,
      dependencyOwnerUserId: dependencyOwner ? dependencyOwner.id : null,
      dependencyOwnerEmail: dependencyOwner ? dependencyOwner.email : null,
      feedbackLink: dto.feedbackLink ?? null,
      status: dto.status ?? null,
      createdByUserId: user.id,
      createdByEmail: user.email,
      tenantId,
    });
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TASK_CREATED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { projectId: saved.projectId, moduleId: saved.moduleId, phaseId: saved.phaseId, sprintId: saved.sprintId },
    });

    return saved;
  }

  async update(
    id: number,
    dto: UpdateTaskDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (!this.canEdit(task, currentUser)) {
      throw new ForbiddenException('You do not have access to edit this task.');
    }

    // E.Hrs lock: once set, only Admin/PM may change it further - the
    // Assignee (who otherwise has general edit rights) is blocked.
    if (dto.estimatedHours !== undefined && task.estimatedHours != null) {
      if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
        throw new ForbiddenException('Estimated Hours is locked after first entry - only Admin or Program Manager can change it now.');
      }
    }

    const previous = { ...task };

    const projectId = dto.projectId ?? task.projectId;
    const moduleId = dto.moduleId ?? task.moduleId;
    const phaseId = dto.phaseId ?? task.phaseId;
    const sprintId = dto.sprintId ?? task.sprintId;
    if (dto.projectId !== undefined || dto.moduleId !== undefined || dto.phaseId !== undefined || dto.sprintId !== undefined) {
      const { project, module, phase, sprint } = await this.resolveChain(projectId, moduleId, phaseId, sprintId, tenantId);
      task.projectId = project.id;
      task.projectName = project.name;
      task.moduleId = module.id;
      task.moduleName = module.name;
      task.phaseId = phase.id;
      task.phaseName = phase.name;
      task.sprintId = sprint.id;
      task.sprintName = sprint.name;
    }

    if (dto.description !== undefined) task.description = dto.description;

    if (dto.assigneeUserId !== undefined) {
      const assignee = await this.usersService.findByIdAndTenant(dto.assigneeUserId, tenantId);
      if (!assignee) {
        throw new NotFoundException(`User #${dto.assigneeUserId} not found`);
      }
      task.assigneeUserId = assignee.id;
      task.assigneeEmail = assignee.email;
    }

    if (dto.estimatedHours !== undefined) task.estimatedHours = dto.estimatedHours;
    if (dto.dueDate !== undefined) task.dueDate = dto.dueDate;

    const resultingDependency = dto.dependency ?? task.dependency;
    const resultingDescription = dto.dependencyDescription ?? task.dependencyDescription;
    const resultingOwnerId = dto.dependencyOwnerUserId !== undefined ? dto.dependencyOwnerUserId : task.dependencyOwnerUserId;
    if (dto.dependency !== undefined || dto.dependencyDescription !== undefined || dto.dependencyOwnerUserId !== undefined) {
      this.assertDependencyFieldsValid(resultingDependency, resultingDescription ?? undefined, resultingOwnerId ?? undefined);
      task.dependency = resultingDependency;
      task.dependencyDescription = resultingDependency ? resultingDescription : null;
      if (dto.dependencyOwnerUserId !== undefined) {
        const owner = resultingDependency ? await this.resolveDependencyOwner(dto.dependencyOwnerUserId, tenantId) : null;
        task.dependencyOwnerUserId = owner ? owner.id : null;
        task.dependencyOwnerEmail = owner ? owner.email : null;
      } else if (!resultingDependency) {
        task.dependencyOwnerUserId = null;
        task.dependencyOwnerEmail = null;
      }
    }

    if (dto.feedbackLink !== undefined) task.feedbackLink = dto.feedbackLink;

    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_UPDATED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  async updateStatus(
    id: number,
    status: TaskStatus,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (!this.canEdit(task, currentUser)) {
      throw new ForbiddenException('You do not have access to update this task.');
    }
    this.assertStatusUnlockable(task.estimatedHours, task.dueDate);

    const fromStatus = task.status;
    task.status = status;
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_STATUS_CHANGED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { from: fromStatus, to: status },
    });

    return saved;
  }
}
