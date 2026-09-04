import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ProjectsService } from '../projects/projects.service';
import { ModulesService } from '../modules/modules.service';
import { PhasesService } from '../phases/phases.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { TaskStatusConfigService } from '../task-status-config/task-status-config.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface ProjectTaskWithComputed extends ProjectTask {
  percentComplete: number | null;
  ageingDays: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Full tenant-wide *view* access (findAllForUser/canView) - Admin and
// Executive both get this, but it's read-only: neither is in
// MUTATE_ROLES below, so neither can create/assign/edit/change-status a
// task. Matches the "Admin/Executive view-only" restriction from the
// original workflow spec.
const LEADERSHIP_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.PROGRAM_MANAGER];
// Every task-mutating action (assign/bulk-assign, editing Backlog fields,
// overriding the E.Hrs lock after first entry, and - via canEdit() below -
// generic field edits and status changes on someone else's task) is
// Program Manager only. Admin is deliberately excluded: it gets full view
// access through LEADERSHIP_ROLES above, same as Executive, but no write
// access - Admin used to be included here, which let it assign/edit tasks
// despite the spec calling for view-only.
const MUTATE_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER];

// Backlog fields (Project/Module/Phase/Description) may only be edited by
// Program Manager, matching who's allowed to create a task in the first
// place - the Assignee's own edit rights (estimatedHours/dueDate) are
// handled separately in update() below.
const BACKLOG_FIELDS: Array<keyof UpdateTaskDto> = ['projectId', 'moduleId', 'phaseId', 'description'];

// Status while a QA review round is pending (Stage 4/5) - the task shows
// up in the QA queue (findQaQueue() below) under either value, whether
// this is the Assignee's first submission or a resubmission after a
// rejection.
const QA_PENDING_STATUSES = ['Feedback', 'Re-Feedback'];

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TaskDependencyTicket)
    private dependencyTicketsRepository: Repository<TaskDependencyTicket>,
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    private projectsService: ProjectsService,
    private modulesService: ModulesService,
    private phasesService: PhasesService,
    private usersService: UsersService,
    private taskStatusConfigService: TaskStatusConfigService,
    private auditLogService: AuditLogService,
  ) {}

  // Also grants view access to the owner of a Dependency Ticket filed
  // against this task (Stage 3, so the Developer clearing it can reach
  // the combined task+ticket detail page) and to any QA user once the
  // task has at least one QA review round (Stage 4/5/6, so QA can open
  // the task from the qa-queue even though they're neither the assignee
  // nor its creator).
  async canView(task: ProjectTask, user: { id: number; role: UserRole }): Promise<boolean> {
    if (LEADERSHIP_ROLES.includes(user.role)) {
      return true;
    }
    if (task.assigneeUserId === user.id || task.createdByUserId === user.id) {
      return true;
    }
    const ownedTicket = await this.dependencyTicketsRepository.findOne({
      where: { parentTaskId: task.id, ownerUserId: user.id },
    });
    if (ownedTicket) {
      return true;
    }
    if (user.role === UserRole.QA) {
      const qaReview = await this.qaReviewsRepository.findOne({ where: { taskId: task.id } });
      if (qaReview) {
        return true;
      }
    }
    return false;
  }

  // Program Manager can edit any task (including unassigned Backlog
  // ones); the Assignee can edit their own assigned task (field-level
  // restrictions - e.g. they can't touch Project/Module/Phase/Description -
  // are enforced in update() below, not here). An unassigned task's
  // assigneeUserId is null, so nobody but PM can match it, which is
  // exactly the "PM edits Backlog, Assignee edits their own" split the
  // workflow needs. Admin/Executive are deliberately excluded - they get
  // read access via canView()/LEADERSHIP_ROLES but not edit access.
  canEdit(task: ProjectTask, user: { id: number; role: UserRole }): boolean {
    if (MUTATE_ROLES.includes(user.role)) {
      return true;
    }
    return task.assigneeUserId === user.id;
  }

  // Validates the Project -> Module -> Phase chain against each other,
  // resolving the denormalized name fields server-side - same pattern as
  // IssuesService.update()'s moduleId/phaseId checks, extended one level
  // further to include Project.
  private async resolveChain(projectId: number, moduleId: number, phaseId: number, tenantId: number) {
    const project = await this.projectsService.findOne(projectId, tenantId);
    const module = await this.modulesService.findOne(moduleId, tenantId);
    if (module.projectId !== project.id) {
      throw new BadRequestException(`Module #${moduleId} belongs to a different project.`);
    }
    const phase = await this.phasesService.findOne(phaseId, tenantId);
    if (phase.moduleId !== module.id) {
      throw new BadRequestException(`Phase #${phaseId} belongs to a different module.`);
    }
    return { project, module, phase };
  }

  // Precondition for submitting a task to QA - checked against the values
  // that WILL be true after this change is applied (either just-supplied
  // or already-stored). Public: TaskQaReviewsService reuses this same
  // check before accepting a Stage 4 QA submission.
  assertReadyForQaSubmission(estimatedHours: number | null, dueDate: string | null): void {
    if (estimatedHours == null || dueDate == null) {
      throw new BadRequestException('Set Estimated Hours and Due Date before submitting for QA testing.');
    }
  }

  private async withComputedFields(task: ProjectTask, tenantId: number, percentByStatus?: Record<string, number>): Promise<ProjectTaskWithComputed> {
    const map = percentByStatus ?? (await this.taskStatusConfigService.percentByStatus(tenantId));
    const percentComplete = task.status != null ? map[task.status] ?? null : null;
    const ageingDays = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / MS_PER_DAY);
    return { ...task, percentComplete, ageingDays };
  }

  async findAllForUser(currentUser: { id: number; role: UserRole }, tenantId: number): Promise<ProjectTaskWithComputed[]> {
    const isLeadership = LEADERSHIP_ROLES.includes(currentUser.role);
    const tasks = isLeadership
      ? await this.tasksRepository.find({ where: { tenantId }, order: { createdAt: 'DESC' } })
      : await this.tasksRepository.find({ where: { tenantId }, order: { createdAt: 'DESC' } }).then((all) =>
          all.filter((t) => t.assigneeUserId === currentUser.id || t.createdByUserId === currentUser.id),
        );

    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    return Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));
  }

  // Task Backlog view - unassigned tasks, Admin/Program Manager only
  // (enforced in the controller).
  async findBacklog(tenantId: number): Promise<ProjectTaskWithComputed[]> {
    const tasks = await this.tasksRepository.find({
      where: { tenantId, assigneeUserId: IsNull() },
      order: { createdAt: 'DESC' },
    });
    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    return Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));
  }

  // QA Review queue (Stage 5) - tasks anyone in QA needs to act on, i.e.
  // there is a QA review round pending. Deliberately status-scoped and
  // tenant-wide, like findBacklog(), rather than assignee-scoped like
  // findMine() below - QA reviewing a task has nothing to do with who
  // it's assigned to.
  async findQaQueue(tenantId: number): Promise<ProjectTaskWithComputed[]> {
    const tasks = await this.tasksRepository.find({
      where: { tenantId, status: In(QA_PENDING_STATUSES) },
      order: { createdAt: 'DESC' },
    });
    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    return Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));
  }

  // My Tasks view - tasks assigned to the current user, whatever their role.
  async findMine(currentUser: { id: number }, tenantId: number): Promise<ProjectTaskWithComputed[]> {
    const tasks = await this.tasksRepository.find({
      where: { tenantId, assigneeUserId: currentUser.id },
      order: { createdAt: 'DESC' },
    });
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

  // Bulk lookup by id, no view-access filtering - callers are trusted
  // internal services (e.g. TaskDependencyTicketsService enriching a
  // ticket list with its parent task's Due Date) that already know these
  // ids are relevant, not a request handler exposing arbitrary tasks.
  findManyByIds(ids: number[], tenantId: number): Promise<ProjectTask[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.tasksRepository.find({ where: { id: In(ids), tenantId } });
  }

  // Stage 1: Program Manager creates a Backlog task - Project/Module/Phase/
  // Description only. No assignee, no E.Hrs, no Due Date yet. Status
  // starts at 'Development' immediately - it's never gated behind other
  // fields being set, since Status is auto-computed, not manually
  // unlocked.
  async create(dto: CreateTaskDto, user: { id: number; email: string }, tenantId: number): Promise<ProjectTask> {
    const { project, module, phase } = await this.resolveChain(dto.projectId, dto.moduleId, dto.phaseId, tenantId);

    const task = this.tasksRepository.create({
      projectId: project.id,
      projectName: project.name,
      moduleId: module.id,
      moduleName: module.name,
      phaseId: phase.id,
      phaseName: phase.name,
      description: dto.description,
      assigneeUserId: null,
      assigneeEmail: null,
      estimatedHours: null,
      dueDate: null,
      status: 'Development',
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
      details: { projectId: saved.projectId, moduleId: saved.moduleId, phaseId: saved.phaseId },
    });

    return saved;
  }

  // Stage 2 kickoff: Admin/Program Manager assigns a Backlog task to a
  // user, moving it out of the Task Backlog and into that user's My Tasks.
  async assignTask(
    id: number,
    assigneeUserId: number,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    const assignee = await this.usersService.findByIdAndTenant(assigneeUserId, tenantId);
    if (!assignee) {
      throw new NotFoundException(`User #${assigneeUserId} not found`);
    }

    task.assigneeUserId = assignee.id;
    task.assigneeEmail = assignee.email;
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_ASSIGNED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { assigneeUserId: assignee.id, assigneeEmail: assignee.email },
    });

    return saved;
  }

  async bulkAssignTasks(
    taskIds: number[],
    assigneeUserId: number,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask[]> {
    const results: ProjectTask[] = [];
    for (const id of taskIds) {
      results.push(await this.assignTask(id, assigneeUserId, currentUser, tenantId));
    }
    return results;
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

    const canMutate = MUTATE_ROLES.includes(currentUser.role);
    if (!canMutate) {
      const attemptedBacklogField = BACKLOG_FIELDS.find((field) => dto[field] !== undefined);
      if (attemptedBacklogField) {
        throw new ForbiddenException('Only Program Manager can edit Project, Module, Phase, or Description.');
      }
    }

    // E.Hrs lock: once set, only Program Manager may change it further -
    // the Assignee (who otherwise has general edit rights) is blocked.
    if (dto.estimatedHours !== undefined && task.estimatedHours != null) {
      if (!canMutate) {
        throw new ForbiddenException('Estimated Hours is locked after first entry - only Program Manager can change it now.');
      }
    }

    // Due Date lock: same one-time-entry pattern as E.Hrs - once set, the
    // Assignee can't change it again. Program Manager is exempt from the
    // lock entirely and may edit Due Date as many times as needed (each
    // such edit gets its own TASK_DUE_DATE_EDITED audit entry below, on
    // top of the general TASK_UPDATED entry every edit already gets).
    if (dto.dueDate !== undefined && task.dueDate != null) {
      if (!canMutate) {
        throw new ForbiddenException('Due Date is locked after first entry - only Program Manager can change it now.');
      }
    }

    const previous = { ...task };
    const isPmDueDateEdit = canMutate && dto.dueDate !== undefined && task.dueDate != null && dto.dueDate !== task.dueDate;

    const projectId = dto.projectId ?? task.projectId;
    const moduleId = dto.moduleId ?? task.moduleId;
    const phaseId = dto.phaseId ?? task.phaseId;
    if (dto.projectId !== undefined || dto.moduleId !== undefined || dto.phaseId !== undefined) {
      const { project, module, phase } = await this.resolveChain(projectId, moduleId, phaseId, tenantId);
      task.projectId = project.id;
      task.projectName = project.name;
      task.moduleId = module.id;
      task.moduleName = module.name;
      task.phaseId = phase.id;
      task.phaseName = phase.name;
    }

    if (dto.description !== undefined) task.description = dto.description;
    if (dto.estimatedHours !== undefined) task.estimatedHours = dto.estimatedHours;
    if (dto.dueDate !== undefined) task.dueDate = dto.dueDate;

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

    if (isPmDueDateEdit) {
      await this.auditLogService.record({
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        action: AuditActions.TASK_DUE_DATE_EDITED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: saved.id,
        details: { previousDueDate: previous.dueDate, newDueDate: saved.dueDate },
      });
    }

    return saved;
  }
}
