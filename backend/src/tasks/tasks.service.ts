import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThanOrEqual, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { TaskDefectArtifact } from './task-defect-artifact.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateDefectTaskDto } from './dto/create-defect-task.dto';
import { ReassignEscalatedTaskDto } from './dto/reassign-escalated-task.dto';
import { ReassignTeamTaskDto } from './dto/reassign-team-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ProjectsService } from '../projects/projects.service';
import { ModulesService } from '../modules/modules.service';
import { PhasesService } from '../phases/phases.service';
import { UsersService } from '../users/users.service';
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';
import { TaskStatusConfigService } from '../task-status-config/task-status-config.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface ProjectTaskWithComputed extends ProjectTask {
  percentComplete: number | null;
  ageingDays: number;
  // Only populated by findMine() and findTeam() (the two views that show a
  // Dependency column) - undefined everywhere else rather than a wasted
  // query on every other task list.
  hasOpenDependency?: boolean;
  // Only populated by findTeam() - the Team Tasks expandable dependency
  // tree needs the actual tickets (not just the boolean above), but only
  // for whichever page is currently on screen, so this is left undefined
  // everywhere else rather than a wasted query on every other task list.
  dependencyTickets?: Array<{ id: number; description: string; ownerEmail: string; status: string }>;
}

export interface TeamTaskFilters {
  page?: number;
  pageSize?: number;
  // Comma-separated list of statuses (e.g. 'Feedback,Re-Feedback' for the
  // Team Tasks "Feedback / Re-Feedback" tab) - a single status still works
  // exactly as before, In([x]) behaves the same as an exact match.
  status?: string;
  assigneeUserId?: number;
  phaseId?: number;
  // 'Yes' | 'No' | undefined ('All') - same three-state shape as the
  // Dependency filter on My Tasks (DeveloperTaskWorkboard.js).
  dependency?: string;
  dueFrom?: string;
  dueTo?: string;
  showCompleted?: boolean;
}

export interface TeamTasksResult {
  tasks: ProjectTaskWithComputed[];
  total: number;
  statCounts: { total: number; rejected: number; openDependency: number; overdue: number };
  assignees: Array<{ id: number; email: string; fullName: string | null }>;
  phases: Array<{ id: number; name: string }>;
}

export interface QaQueueResult {
  tasks: ProjectTaskWithComputed[];
  statCounts: { pending: number; resubmissions: number; overdue: number; approved: number; rejected: number };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Tasks in these statuses are done - mirrors COMPLETED_STATUSES in
// frontend/components/DeveloperTaskWorkboard.js exactly (no shared
// constants file between frontend/backend in this codebase, so keep the
// two lists in sync by hand if TASK_STATUSES ever changes). Used by
// findTeam() below to hide Pass/Released tasks by default, same as My
// Tasks.
const COMPLETED_STATUSES = ['Pass', 'Junk', 'Released - No Showstoppers', 'Released - With Showstoppers'];

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

// Peer Review's equivalent of QA_PENDING_STATUSES above - see
// findPeerReviewQueue() and PeerReviewsService.submit().
const PEER_REVIEW_PENDING_STATUSES = ['Peer Review', 'Re-Peer-Review'];

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TaskDependencyTicket)
    private dependencyTicketsRepository: Repository<TaskDependencyTicket>,
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    @InjectRepository(TaskDefectArtifact)
    private defectArtifactsRepository: Repository<TaskDefectArtifact>,
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
    // Same grant as the QA branch above, for a Peer Review reviewer - a
    // Developer/Designer/DevOps who was ever picked as reviewerUserId on
    // one of this task's review rounds (even a resolved one) can open it,
    // though they're neither the Assignee nor its creator.
    if (DEVELOPER_EQUIVALENT_ROLES.includes(user.role)) {
      const peerReview = await this.qaReviewsRepository.findOne({ where: { taskId: task.id, reviewerUserId: user.id } });
      if (peerReview) {
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
    // The QA who raised a defect ticket keeps edit rights on its Backlog
    // fields (Project/Module/Phase/Description) - see the BACKLOG_FIELDS
    // check in update() below, which is where that's actually scoped to
    // just those fields (not Estimated Hours/Due Date, which stay
    // Assignee/PM-only same as any other task).
    if (task.isDefect && task.createdByUserId === user.id) {
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

  // Hard block, no role exception: a task with an open Dependency Ticket
  // cannot be submitted for QA. Deliberately QA-only - called from
  // TaskQaReviewsService.submit() alone, never from PeerReviewsService.submit()
  // or from assertReadyForQaSubmission() above (which both submit paths
  // share), so an open dependency ticket never blocks the Peer Review path.
  async assertNoOpenDependencyTickets(taskId: number, tenantId: number): Promise<void> {
    const openTickets = await this.dependencyTicketsRepository.find({
      where: { parentTaskId: taskId, tenantId, status: 'open' },
    });
    if (openTickets.length === 0) {
      return;
    }
    const label = openTickets.length === 1 ? 'ticket' : 'tickets';
    const ids = openTickets.map((t) => `#${t.id}`).join(', ');
    throw new BadRequestException(`Cannot submit for QA - resolve the open dependency ${label} ${ids} first.`);
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

  // PM Escalation queue - tasks QA escalated instead of Approve/Reject,
  // tenant-wide and shared across every PM (not self-scoped to whoever
  // escalated it - that's a QA identity, not a PM one), same
  // shared-queue shape as findBacklog() above. Enriched with the
  // escalation comment/who-escalated-it from the latest 'escalated' round
  // on each task (one extra batch query, not stored on ProjectTask
  // itself) so the PM has context without opening the task detail page.
  async findEscalationQueue(tenantId: number): Promise<Array<ProjectTaskWithComputed & { escalationComment: string | null; escalatedByEmail: string | null }>> {
    const tasks = await this.tasksRepository.find({
      where: { tenantId, status: 'Escalated' },
      order: { createdAt: 'DESC' },
    });
    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    const withComputed = await Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));
    if (tasks.length === 0) return withComputed.map((t) => ({ ...t, escalationComment: null, escalatedByEmail: null }));

    const escalatedRounds = await this.qaReviewsRepository.find({
      where: { tenantId, taskId: In(tasks.map((t) => t.id)), status: 'escalated' },
      order: { roundNumber: 'DESC' },
    });
    const latestByTask = new Map<number, TaskQaReview>();
    for (const round of escalatedRounds) {
      if (!latestByTask.has(round.taskId)) latestByTask.set(round.taskId, round);
    }
    return withComputed.map((t) => {
      const round = latestByTask.get(t.id);
      return { ...t, escalationComment: round?.qaComment ?? null, escalatedByEmail: round?.reviewedByEmail ?? null };
    });
  }

  // QA Review queue (Stage 5) - tasks anyone in QA needs to act on, i.e.
  // there is a QA review round pending. Deliberately status-scoped and
  // tenant-wide, like findBacklog(), rather than assignee-scoped like
  // findMine() below - QA reviewing a task has nothing to do with who
  // it's assigned to.
  //
  // `status` is an optional escape hatch for the QA Review page's
  // Approved/Rejected stat cards: those aren't part of the pending queue
  // at all (a task leaves Feedback/Re-Feedback for Pass/Failed the moment
  // QA decides it - see TaskQaReviewsService.approve()/reject()), so
  // loading either list means querying by that status directly instead of
  // QA_PENDING_STATUSES. Deliberately not scoped to QA-decided tasks only -
  // Pass/Failed can also come from the separate Peer Review path
  // (PeerReviewsService), and this endpoint doesn't distinguish the two,
  // same as the Status badge shown elsewhere never distinguishes them
  // either. `isDefect: false` on every branch keeps defect tickets out of
  // this shared, pick-up-anything queue entirely - they only ever surface
  // in findDefectQueue() below, self-scoped to the QA who raised them.
  async findQaQueue(tenantId: number, status?: string): Promise<QaQueueResult> {
    const pendingTasks = await this.tasksRepository.find({
      where: { tenantId, isDefect: false, status: In(QA_PENDING_STATUSES) },
      order: { createdAt: 'DESC' },
    });
    const today = new Date().toISOString().slice(0, 10);
    const statCounts = {
      pending: pendingTasks.length,
      resubmissions: pendingTasks.filter((t) => t.status === 'Re-Feedback').length,
      overdue: pendingTasks.filter((t) => t.dueDate && t.dueDate < today).length,
      approved: await this.tasksRepository.count({ where: { tenantId, isDefect: false, status: 'Pass' } }),
      rejected: await this.tasksRepository.count({ where: { tenantId, isDefect: false, status: 'Failed' } }),
    };

    let tasks: ProjectTask[];
    if (status === 'Pass' || status === 'Failed') {
      tasks = await this.tasksRepository.find({ where: { tenantId, isDefect: false, status }, order: { createdAt: 'DESC' } });
    } else if (status === 'Feedback' || status === 'Re-Feedback') {
      tasks = pendingTasks.filter((t) => t.status === status);
    } else {
      tasks = pendingTasks;
    }

    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    const withComputed = await Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));
    return { tasks: withComputed, statCounts };
  }

  // Defect queue - the mirror image of findQaQueue() above, but self-
  // scoped to the QA user who raised the defect (createdByUserId) instead
  // of tenant-wide, same self-scoping reasoning as findPeerReviewQueue()
  // (just keyed off createdByUserId instead of TaskQaReview.reviewerUserId,
  // since a defect's "reviewer" is fixed at creation time, not picked at
  // submit time). Same shape (QaQueueResult) so the frontend can reuse
  // QaReviewWorkboard's cards/table/filters unchanged.
  async findDefectQueue(currentUser: { id: number }, tenantId: number, status?: string): Promise<QaQueueResult> {
    const baseWhere = { tenantId, isDefect: true, createdByUserId: currentUser.id };
    const pendingTasks = await this.tasksRepository.find({
      where: { ...baseWhere, status: In(QA_PENDING_STATUSES) },
      order: { createdAt: 'DESC' },
    });
    const today = new Date().toISOString().slice(0, 10);
    const statCounts = {
      pending: pendingTasks.length,
      resubmissions: pendingTasks.filter((t) => t.status === 'Re-Feedback').length,
      overdue: pendingTasks.filter((t) => t.dueDate && t.dueDate < today).length,
      approved: await this.tasksRepository.count({ where: { ...baseWhere, status: 'Pass' } }),
      rejected: await this.tasksRepository.count({ where: { ...baseWhere, status: 'Failed' } }),
    };

    let tasks: ProjectTask[];
    if (status === 'Pass' || status === 'Failed') {
      tasks = await this.tasksRepository.find({ where: { ...baseWhere, status }, order: { createdAt: 'DESC' } });
    } else if (status === 'Feedback' || status === 'Re-Feedback') {
      tasks = pendingTasks.filter((t) => t.status === status);
    } else {
      tasks = pendingTasks;
    }

    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    const withComputed = await Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));
    return { tasks: withComputed, statCounts };
  }

  // Peer Review queue - tasks with a Peer Review round pending, scoped to
  // the specific Developer picked as reviewer (unlike findQaQueue() above,
  // which is tenant-wide since any QA teammate can pick up any task - a
  // Peer Review round is assigned to one specific person, so this is
  // self-scoped like findMine() below instead).
  async findPeerReviewQueue(currentUser: { id: number }, tenantId: number): Promise<ProjectTaskWithComputed[]> {
    const pendingRounds = await this.qaReviewsRepository.find({
      where: { tenantId, reviewType: 'peer', reviewerUserId: currentUser.id, status: 'pending' },
    });
    if (pendingRounds.length === 0) return [];
    const tasks = await this.tasksRepository.find({
      where: { tenantId, id: In(pendingRounds.map((r) => r.taskId)), status: In(PEER_REVIEW_PENDING_STATUSES) },
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
    const withComputed = await Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));

    if (tasks.length === 0) return withComputed;
    const openTickets = await this.dependencyTicketsRepository.find({
      where: { parentTaskId: In(tasks.map((t) => t.id)), status: 'open' },
    });
    const taskIdsWithOpenDependency = new Set(openTickets.map((t) => t.parentTaskId));
    return withComputed.map((t) => ({ ...t, hasOpenDependency: taskIdsWithOpenDependency.has(t.id) }));
  }

  // Team Tasks view - every assigned task in the tenant, for Admin/
  // Executive/Program Manager (leadership-wide, not project-scoped - same
  // grant findAllForUser() gives those roles, just with server-side
  // filtering/pagination since this spans every assignee instead of just
  // the current user). Access is gated in the controller, not here.
  //
  // Filtering happens in two DB-level passes plus one JS-level pass:
  // 1. `where` covers every filter TypeORM can express directly (status,
  //    assigneeUserId, due range, showCompleted) and is used for the
  //    paginated row fetch.
  // 2. `cardWhere` is the same idea but only ever applies showCompleted/
  //    assigneeUserId - it's the scope the stat cards themselves are
  //    computed against, so clicking a card (which sets status/dependency/
  //    due filters) doesn't change the card counts out from under the
  //    user, same as DeveloperTaskWorkboard's cards read from
  //    `visibleTasks` rather than the filtered table rows.
  // 3. The Dependency filter can't be expressed as a `where` column at
  //    all (it depends on a join to task_dependency_tickets), so it's
  //    applied in JS against a Set of open-ticket task ids, exactly like
  //    findMine() above already does for its own Dependency column.
  async findTeam(tenantId: number, filters: TeamTaskFilters): Promise<TeamTasksResult> {
    const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(Math.floor(filters.pageSize), 200) : 50;

    const where: Record<string, any> = { tenantId, assigneeUserId: Not(IsNull()) };
    if (filters.status && filters.status !== 'All') {
      const statusList = filters.status.split(',').map((s) => s.trim()).filter(Boolean);
      where.status = In(statusList);
    } else if (!filters.showCompleted) {
      where.status = Not(In(COMPLETED_STATUSES));
    }
    if (filters.assigneeUserId) {
      where.assigneeUserId = filters.assigneeUserId;
    }
    if (filters.phaseId) {
      where.phaseId = filters.phaseId;
    }
    if (filters.dueFrom && filters.dueTo) {
      where.dueDate = Between(filters.dueFrom, filters.dueTo);
    } else if (filters.dueFrom) {
      where.dueDate = MoreThanOrEqual(filters.dueFrom);
    } else if (filters.dueTo) {
      where.dueDate = LessThanOrEqual(filters.dueTo);
    }

    const matching = await this.tasksRepository.find({ where, order: { createdAt: 'DESC' } });
    const openDependencyIds = await this.findOpenDependencyTaskIds(matching.map((t) => t.id));

    let filtered = matching;
    if (filters.dependency === 'Yes') {
      filtered = filtered.filter((t) => openDependencyIds.has(t.id));
    } else if (filters.dependency === 'No') {
      filtered = filtered.filter((t) => !openDependencyIds.has(t.id));
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const pageTasks = filtered.slice(start, start + pageSize);

    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    const withComputed = await Promise.all(pageTasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));
    const dependencyTicketsByTaskId = await this.findDependencyTicketsForTasks(pageTasks.map((t) => t.id));
    const tasks = withComputed.map((t) => ({
      ...t,
      hasOpenDependency: openDependencyIds.has(t.id),
      dependencyTickets: dependencyTicketsByTaskId.get(t.id) || [],
    }));

    const cardWhere: Record<string, any> = { tenantId, assigneeUserId: filters.assigneeUserId || Not(IsNull()) };
    if (!filters.showCompleted) {
      cardWhere.status = Not(In(COMPLETED_STATUSES));
    }
    const cardScopeTasks = await this.tasksRepository.find({ where: cardWhere });
    const cardOpenDependencyIds = await this.findOpenDependencyTaskIds(cardScopeTasks.map((t) => t.id));
    const today = new Date().toISOString().slice(0, 10);
    const statCounts = {
      total: cardScopeTasks.length,
      rejected: cardScopeTasks.filter((t) => t.status === 'Failed').length,
      openDependency: cardScopeTasks.filter((t) => cardOpenDependencyIds.has(t.id)).length,
      overdue: cardScopeTasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== 'Pass' && t.status !== 'Junk').length,
    };

    const assignees = await this.findTeamAssignees(tenantId);
    const phases = await this.findTeamPhases(tenantId);

    return { tasks, total, statCounts, assignees, phases };
  }

  // The Team Tasks expandable dependency tree's data - every dependency
  // ticket (open or resolved; the tree is meant to show the full picture
  // of what a task depends on, not just what's still blocking it) for
  // whichever page of tasks is currently on screen, grouped by
  // parentTaskId. Deliberately scoped to just those task ids rather than
  // the whole matching set, same reasoning as withComputedFields above -
  // this only ever needs to answer for the ~25-100 rows actually rendered.
  private async findDependencyTicketsForTasks(
    taskIds: number[],
  ): Promise<Map<number, Array<{ id: number; description: string; ownerEmail: string; status: string }>>> {
    const map = new Map<number, Array<{ id: number; description: string; ownerEmail: string; status: string }>>();
    if (taskIds.length === 0) return map;
    const tickets = await this.dependencyTicketsRepository.find({ where: { parentTaskId: In(taskIds) } });
    for (const ticket of tickets) {
      const existing = map.get(ticket.parentTaskId) || [];
      existing.push({ id: ticket.id, description: ticket.description, ownerEmail: ticket.ownerEmail, status: ticket.status });
      map.set(ticket.parentTaskId, existing);
    }
    return map;
  }

  // Team Tasks' Project Phase filter dropdown - same "distinct value
  // already on tenant tasks" convention as findTeamAssignees below,
  // rather than a join out to the Phases module: phaseId/phaseName are
  // already denormalized onto every task row.
  private async findTeamPhases(tenantId: number): Promise<Array<{ id: number; name: string }>> {
    const rows = await this.tasksRepository.find({
      where: { tenantId, assigneeUserId: Not(IsNull()) },
      select: ['phaseId', 'phaseName'],
    });
    const byId = new Map<number, string>();
    for (const r of rows) byId.set(r.phaseId, r.phaseName);
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async findOpenDependencyTaskIds(taskIds: number[]): Promise<Set<number>> {
    if (taskIds.length === 0) return new Set();
    const openTickets = await this.dependencyTicketsRepository.find({
      where: { parentTaskId: In(taskIds), status: 'open' },
    });
    return new Set(openTickets.map((t) => t.parentTaskId));
  }

  // Distinct list of everyone with at least one assigned task in the
  // tenant, for the Assignee filter dropdown - deliberately not scoped by
  // showCompleted/status/etc (a stable list, not one that shrinks as the
  // user filters, the same reasoning selectableStatuses documents for why
  // it prunes but the Assignee list here should not).
  private async findTeamAssignees(tenantId: number): Promise<Array<{ id: number; email: string; fullName: string | null }>> {
    const rows = await this.tasksRepository.find({
      where: { tenantId, assigneeUserId: Not(IsNull()) },
      select: ['assigneeUserId'],
    });
    const uniqueIds = Array.from(new Set(rows.map((r) => r.assigneeUserId)));
    if (uniqueIds.length === 0) return [];
    const users = await this.usersService.findByIds(uniqueIds, tenantId);
    return users
      .map((u) => ({ id: u.id, email: u.email, fullName: u.fullName }))
      .sort((a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email));
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
      peerReviewEnabled: dto.peerReviewEnabled ?? false,
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

  // Create Defect (QA only) - a fresh, standalone ticket with no link to
  // any other ticket/task, assigned straight to a Developer, skipping the
  // Task Backlog stage entirely (contrast with create() above, which
  // starts unassigned). Project/Module/Phase are still resolved/validated
  // through the same chain as every other task - required for the same
  // scoping/KPI/dashboard reasons, not dropped just because this is a
  // shortcut path.
  async createDefect(dto: CreateDefectTaskDto, user: { id: number; email: string }, tenantId: number): Promise<ProjectTask> {
    const { project, module, phase } = await this.resolveChain(dto.projectId, dto.moduleId, dto.phaseId, tenantId);

    const assignee = await this.usersService.findByIdAndTenant(dto.assigneeUserId, tenantId);
    if (!assignee) {
      throw new NotFoundException(`User #${dto.assigneeUserId} not found`);
    }
    if (!DEVELOPER_EQUIVALENT_ROLES.includes(assignee.role)) {
      throw new BadRequestException('A defect can only be assigned to a Developer, Designer, or DevOps.');
    }

    // Task row + its optional evidence artifacts are saved together in a
    // transaction, same reasoning as TaskQaReviewsService.submit() - a
    // defect can never land with some artifacts missing because of a
    // failure partway through.
    const saved = await this.tasksRepository.manager.transaction(async (manager) => {
      const task = manager.create(ProjectTask, {
        projectId: project.id,
        projectName: project.name,
        moduleId: module.id,
        moduleName: module.name,
        phaseId: phase.id,
        phaseName: phase.name,
        description: dto.description,
        assigneeUserId: assignee.id,
        assigneeEmail: assignee.email,
        estimatedHours: null,
        dueDate: null,
        status: 'Development',
        peerReviewEnabled: false,
        isDefect: true,
        createdByUserId: user.id,
        createdByEmail: user.email,
        tenantId,
      });
      const savedTask = await manager.save(ProjectTask, task);

      const artifacts = (dto.artifacts || []).map((item) =>
        manager.create(TaskDefectArtifact, {
          taskId: savedTask.id,
          type: item.type,
          url: item.url,
        }),
      );
      if (artifacts.length > 0) {
        await manager.save(TaskDefectArtifact, artifacts);
      }

      return savedTask;
    });

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TASK_DEFECT_CREATED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: {
        projectId: saved.projectId,
        moduleId: saved.moduleId,
        phaseId: saved.phaseId,
        assigneeUserId: assignee.id,
        artifactTypes: (dto.artifacts || []).map((a) => a.type),
      },
    });

    return saved;
  }

  // Read-only lookup for the evidence QA attached at Create Defect time -
  // shown alongside the task (task detail page, my-defects queue) so
  // anyone who can view the task can see what was filed. No tenant/access
  // check here beyond taskId matching - callers already gate on
  // canView(task, user) before reaching this, same as findForTask() does
  // for QA review artifacts.
  findDefectArtifacts(taskId: number): Promise<TaskDefectArtifact[]> {
    return this.defectArtifactsRepository.find({ where: { taskId } });
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

  // Team Tasks - PM edits the Assignee directly on an already-assigned
  // task (or, same endpoint, an unassigned Backlog one). Deliberately the
  // same core mutation as assignTask() above (just assigneeUserId/Email),
  // generalized to also accept null: leaving it blank clears the task
  // back to assigneeUserId null, i.e. it reappears in Task Backlog exactly
  // like a normal unassigned task there (findBacklog() only ever filters
  // on assigneeUserId, never on status).
  //
  // Deliberately does NOT touch status, any TaskQaReview row, or any
  // TaskDependencyTicket row - each of those is already routed independent
  // of assigneeUserId (a pending Peer Review round by reviewerUserId, an
  // Escalation to PM by status alone into a tenant-wide queue, a
  // Dependency Ticket by ownerUserId), so whatever's in flight keeps
  // running exactly where it already is until that step resolves on its
  // own - reassigning here can never silently cancel or reroute it. Past
  // TaskQaReview rows stay attributed to submittedByUserId/reviewerUserId
  // as recorded at the time, never rewritten to the new assignee, for the
  // same reason.
  async reassignTeamTask(
    id: number,
    dto: ReassignTeamTaskDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    const previousAssigneeUserId = task.assigneeUserId;
    const previousAssigneeEmail = task.assigneeEmail;

    if (dto.assigneeUserId == null) {
      task.assigneeUserId = null;
      task.assigneeEmail = null;
    } else {
      const assignee = await this.usersService.findByIdAndTenant(dto.assigneeUserId, tenantId);
      if (!assignee) {
        throw new NotFoundException(`User #${dto.assigneeUserId} not found`);
      }
      task.assigneeUserId = assignee.id;
      task.assigneeEmail = assignee.email;
    }
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_REASSIGNED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: {
        previousAssigneeUserId,
        previousAssigneeEmail,
        assigneeUserId: saved.assigneeUserId,
        assigneeEmail: saved.assigneeEmail,
      },
    });

    return saved;
  }

  // PM Escalation queue, option (a): reassign to a Developer (any
  // Developer, not necessarily the original assignee) - sends it back
  // into the normal task flow (status 'Development'). Estimated Hours/
  // Due Date are left as-is (confirmed with the user), unlike Create
  // Defect's fresh assignment. This is deliberately not a rejection and
  // doesn't touch task_qa_reviews at all - the escalated round stays on
  // the books as history, and pass/fail counting only happens the next
  // time this task actually goes through submit()/approve()/reject().
  async reassignEscalatedTask(
    id: number,
    dto: ReassignEscalatedTaskDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (task.status !== 'Escalated') {
      throw new BadRequestException('Only an escalated task can be reassigned this way.');
    }
    const assignee = await this.usersService.findByIdAndTenant(dto.assigneeUserId, tenantId);
    if (!assignee) {
      throw new NotFoundException(`User #${dto.assigneeUserId} not found`);
    }
    if (!DEVELOPER_EQUIVALENT_ROLES.includes(assignee.role)) {
      throw new BadRequestException('An escalated task can only be reassigned to a Developer, Designer, or DevOps.');
    }

    const previousAssigneeUserId = task.assigneeUserId;
    task.assigneeUserId = assignee.id;
    task.assigneeEmail = assignee.email;
    task.status = 'Development';
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_ESCALATION_REASSIGNED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { previousAssigneeUserId, assigneeUserId: assignee.id, assigneeEmail: assignee.email },
    });

    return saved;
  }

  // PM Escalation queue, option (b): close as Junk - a distinct, terminal
  // status from Pass/Failed, fully excluded from KPI (KpiService.
  // computeMetrics()'s `Not('Junk')` filters), since an escalated ticket
  // being closed this way means it was never a real issue in the first
  // place.
  async closeAsJunk(
    id: number,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (task.status !== 'Escalated') {
      throw new BadRequestException('Only an escalated task can be closed as Junk this way.');
    }

    task.status = 'Junk';
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_ESCALATION_CLOSED_JUNK,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: {},
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

    const canMutate = MUTATE_ROLES.includes(currentUser.role);
    // The QA who raised this defect is allowed through canEdit() above
    // specifically to edit Backlog fields - not to touch Estimated Hours/
    // Due Date, which stay Assignee/PM-only same as any other task, so
    // that's blocked outright here rather than relying on the "once set"
    // locks below (which wouldn't catch a QA raiser setting either field
    // for the *first* time, before the Assignee gets to it).
    const isDefectRaiser = task.isDefect && task.createdByUserId === currentUser.id;
    if (!canMutate) {
      const attemptedBacklogField = BACKLOG_FIELDS.find((field) => dto[field] !== undefined);
      if (attemptedBacklogField && !isDefectRaiser) {
        throw new ForbiddenException('Only Program Manager can edit Project, Module, Phase, or Description.');
      }
      if (isDefectRaiser && (dto.estimatedHours !== undefined || dto.dueDate !== undefined)) {
        throw new ForbiddenException('QA cannot edit Estimated Hours or Due Date.');
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

  // Dedicated setter for the Peer Review checkbox on an already-existing
  // task (PATCH /tasks/:id/peer-review-flag, Program Manager or Admin
  // only - see TasksController) - deliberately separate from update()/
  // UpdateTaskDto/canEdit() above, so this feature can grant Admin a
  // narrow write exception (Admin has view-only access to every other
  // task field) without touching the general edit path's authorization at
  // all. Always allowed regardless of the task's current status - see
  // ProjectTask.peerReviewEnabled for why a mid-review change is safe:
  // it's only consulted the next time the Assignee submits, never
  // retroactively.
  async setPeerReviewFlag(
    id: number,
    peerReviewEnabled: boolean,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (task.peerReviewEnabled === peerReviewEnabled) {
      return task;
    }

    const previous = task.peerReviewEnabled;
    task.peerReviewEnabled = peerReviewEnabled;
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_PEER_REVIEW_FLAG_CHANGED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { previous, updated: peerReviewEnabled, taskStatusAtChange: task.status },
    });

    return saved;
  }
}
