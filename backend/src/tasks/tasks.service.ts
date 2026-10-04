import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThanOrEqual, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { TaskDefectArtifact } from './task-defect-artifact.entity';
import { TaskBlockingDefect } from './task-blocking-defect.entity';
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
import { TaskPriority } from './task-priority.enum';
import { TaskStatusConfigService } from '../task-status-config/task-status-config.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { sanitizeRichText } from '../common/sanitize-rich-text';
import { addBusinessDays, toDateOnlyString } from '../common/business-days';

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
  dependencyTickets?: Array<{ id: number; title: string; description: string; ownerEmail: string; status: string }>;
  // Only populated by findQaQueue()/findDefectQueue() (QA Review's Assignee
  // column) - Team Tasks/KPI already have a separate id-keyed user list
  // fetched client-side to build their own display label from, so this
  // would be a wasted lookup on every other task list.
  assigneeFullName?: string;
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
  // 'Yes' | 'No' | undefined ('All') - same three-state shape as
  // `dependency` above, but a plain column so it goes straight into the
  // `where` clause instead of needing dependency's JS post-filter.
  isDefect?: string;
  dueFrom?: string;
  dueTo?: string;
  showCompleted?: boolean;
  // Same "hidden by default, toggle to reveal" shape as showCompleted
  // above, for Hold/Closed instead of Pass/Junk/Released - see
  // HOLD_CLOSED_STATUSES.
  showHoldClosed?: boolean;
  // Workload view only (TeamTaskWorkboard.js) - returns every matching
  // task in one response instead of one page, since a weekly assignee×week
  // grid needs the full filtered set to bucket correctly, not just
  // whatever page happens to be current. Table/Tiles never set this, so
  // their normal pagination is unaffected.
  all?: boolean;
  // Team Tasks' Development / Failed tab only - merges the open dependency
  // tickets the selected assignee owns (TeamDependencyRow) into the same
  // paginated list as the tasks, ahead of them, so `total`/pagination
  // count both. The frontend only sets this while no task-only filter
  // (phase/dependency/defect/due) is active - tickets have none of those
  // fields to filter on.
  includeDependencies?: boolean;
}

export interface TeamTasksResult {
  // ProjectTaskWithComputed rows, plus TeamDependencyRows (ahead of them)
  // when filters.includeDependencies - tell them apart by `kind`.
  tasks: Array<ProjectTaskWithComputed | TeamDependencyRow>;
  total: number;
  statCounts: { total: number; rejected: number; openDependency: number; overdue: number; defects: number };
  assignees: Array<{ id: number; email: string; fullName: string | null }>;
  phases: Array<{ id: number; name: string }>;
  // Open dependency tickets the selected assignee (or, with no assignee
  // filter, anyone) owns and needs to clear - including ones raised from
  // other people's tasks. The opposite direction from
  // statCounts.openDependency (the selected person's own tasks waiting on
  // someone else). Always returned, for the Development / Failed tab's
  // "N to clear" label, regardless of which tab is active.
  dependenciesToClearCount: number;
  // How many of `total` (and of the rows in `tasks`, across all pages)
  // are TeamDependencyRows - 0 unless filters.includeDependencies.
  includedDependencyCount: number;
}

// An open dependency ticket shown as a row/card in Team Tasks' own grid,
// alongside tasks (Development / Failed tab only - see
// TeamTaskFilters.includeDependencies). Field names deliberately mirror
// ProjectTaskWithComputed wherever the meaning lines up, so the table's
// client-side column sorting works across both kinds without special
// cases: assignee = the ticket's owner (who must clear it), dueDate = the
// parent task's due date (a ticket has none of its own - shown labeled
// "Task due", confirmed with the user 2026-10), project/module = the
// parent task's. Columns a ticket has no equivalent for are null.
export interface TeamDependencyRow {
  kind: 'dependency';
  id: number;
  title: string;
  status: 'Open';
  assigneeUserId: number;
  assigneeEmail: string;
  createdByEmail: string;
  createdAt: Date;
  ageingDays: number;
  dueDate: string | null;
  projectName: string | null;
  moduleName: string | null;
  parentTaskId: number;
  parentTaskTitle: string | null;
  priority: null;
  estimatedHours: null;
  percentComplete: null;
  hasOpenDependency: false;
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

// 'Hold' and 'Closed' (see project-task.entity.ts's `status` comment) -
// neither is "completed" (a Held task is still expected to finish once
// released; a Closed one was force-ended, not resolved), so they're kept
// separate from COMPLETED_STATUSES above rather than folded into it: Team
// Tasks/Task Backlog hide them by default behind their own toggle
// (TeamTaskFilters.showHoldClosed), independent of "Show completed
// tasks". Also used to pause every overdue/SLA calculation that keys off
// these two lists (findTeam()'s stat card below, KpiService.
// computeMetrics()) - a Held or Closed task should never count as
// overdue or drag down KPI while nobody's expected to be acting on it.
export const HOLD_CLOSED_STATUSES = ['Hold', 'Closed'];

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
const BACKLOG_FIELDS: Array<keyof UpdateTaskDto> = ['projectId', 'moduleId', 'phaseId', 'title', 'description'];

// Sort weight for My Tasks/Team Tasks/Task Backlog - Immediate first, then
// High, then Medium, with unset ("Not Set") tasks pushed to the bottom.
// Kept out of PRIORITY_RANK's reach so a typo'd/removed enum value falls
// back to "unset" rather than throwing.
const PRIORITY_RANK: Record<string, number> = {
  [TaskPriority.IMMEDIATE]: 0,
  [TaskPriority.HIGH]: 1,
  [TaskPriority.MEDIUM]: 2,
};

// Status while a QA review round is pending (Stage 4/5) - the task shows
// up in the QA queue (findQaQueue() below) under either value, whether
// this is the Assignee's first submission or a resubmission after a
// rejection.
const QA_PENDING_STATUSES = ['Feedback', 'Re-Feedback'];

// Peer Review's equivalent of QA_PENDING_STATUSES above - see
// findPeerReviewQueue() and PeerReviewsService.submit().
const PEER_REVIEW_PENDING_STATUSES = ['Peer Review', 'Re-Peer-Review'];

// "Open" for a defect (findDefectQueue() below) is wider than
// QA_PENDING_STATUSES above - QA_PENDING_STATUSES only covers a task
// while a QA review round is actually pending, but a freshly-raised
// defect starts at 'Development' (assigned to a Developer, not yet
// submitted back) and stays open the whole time it's with them, not just
// once it comes back for QA's decision. Without this, a QA person who
// just raised a defect would see nothing in My Defects until the
// Developer submitted it - every non-terminal status counts as open here.
const OPEN_DEFECT_STATUSES = ['Development', 'Feedback', 'Re-Feedback', 'Escalated'];

// "Resolved" for a *linked* defect (assertNoOpenLinkedDefects() below) -
// deliberately not OPEN_DEFECT_STATUSES's complement. That constant
// answers "does this belong in QA's My Defects open-count", where
// 'Failed' already counts as not-open because a QA rejection is expected
// to loop straight back into 'Re-Feedback' via the Assignee's resubmit.
// A linked defect blocking a parent task needs a stricter bar: if QA
// rejects the linked defect itself and nobody has resubmitted it yet, it
// must keep blocking the parent - it is not resolved just because it's
// momentarily sitting at 'Failed'. Only an actual QA pass, the PM
// closing it as Junk, or PM/Admin force-Closing it (closeTask() - added
// 2026-10, confirmed with the user, so a Closed defect can't block
// forever) lifts the block. Hold still blocks. Applies to both
// spun-off (parentTaskId) and manually linked (TaskBlockingDefect)
// defects.
const LINKED_DEFECT_RESOLVED_STATUSES = ['Pass', 'Junk', 'Closed'];

// Who can add/remove a TaskBlockingDefect link (confirmed with the user
// 2026-10) - QA scoped to their assigned projects, Program Manager
// tenant-wide. Admin stays view-only, same as the rest of Tasks.
export const ROLES_ALLOWED_TO_LINK_BLOCKING_DEFECTS: UserRole[] = [UserRole.QA, UserRole.PROGRAM_MANAGER];

type UserWithProjects = { id: number; email?: string; role: UserRole; projects?: { id: number }[] };

// How far out ProjectTask.qaReviewDueDate is set on every QA/Peer Review
// submission (TasksService.computeQaReviewDueDate() below) - a fixed
// constant, not an admin-configurable setting, per the confirmed spec for
// this feature. Business days only (Mon-Fri), no company holiday
// calendar - see business-days.ts.
const QA_REVIEW_DUE_DATE_BUSINESS_DAYS = 5;

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
    @InjectRepository(TaskBlockingDefect)
    private blockingDefectsRepository: Repository<TaskBlockingDefect>,
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
  // nor its creator). QA can also open any task in a project they're
  // assigned to (added 2026-10 for Link Blocking Defect - confirmed with
  // the user), which requires the caller to pass a user loaded with
  // `projects` (UsersService.findById does).
  async canView(task: ProjectTask, user: UserWithProjects): Promise<boolean> {
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
    if (user.role === UserRole.QA && this.isInAssignedProject(task, user)) {
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

  // A task whose Assignee is QA must go through Peer Review (a Developer/
  // Designer/DevOps reviews it) rather than the normal QA-submit path -
  // findQaQueue()/approve()/reject() have no self-review guard (any QA
  // user, including the assignee themselves, can approve/reject a pending
  // round), so letting a QA assignee's own work land in that shared queue
  // would let QA review its own work. Applied everywhere a task can gain
  // a QA assignee (create() above, assignTask()/reassignTeamTask() below,
  // and TasksBulkService.import()) so it can't be bypassed by using a
  // different assign path. Public so TasksBulkService can reuse the exact
  // same rule for bulk-imported rows instead of re-deriving it.
  requiresPeerReviewForAssignee(assigneeRole: UserRole | undefined): boolean {
    return assigneeRole === UserRole.QA;
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

  // ProjectTask.qaReviewDueDate - called from both TaskQaReviewsService.
  // submit() and PeerReviewsService.submit() at the exact moment each sets
  // task.status to Feedback/Re-Feedback or Peer Review/Re-Peer-Review, so
  // "reset fresh on every resubmission" falls out for free (both a first
  // submission and every later resubmission go through this same call
  // site in each service, with no separate branch needed).
  computeQaReviewDueDate(from: Date): string {
    return toDateOnlyString(addBusinessDays(from, QA_REVIEW_DUE_DATE_BUSINESS_DAYS));
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

  // Same shape as assertNoOpenDependencyTickets() above, and coexists
  // with it - either an open Dependency Ticket OR an open linked Defect
  // independently blocks resubmission. "Linked" covers both defects spun
  // off this task's QA rejection (parentTaskId) and existing defects QA/PM
  // linked as blocking (TaskBlockingDefect). Deliberately QA-only for the
  // same reason: called from TaskQaReviewsService.submit() alone, never
  // from PeerReviewsService.submit() (confirmed with the user 2026-10).
  async assertNoOpenLinkedDefects(taskId: number, tenantId: number): Promise<void> {
    const openDefects = await this.findOpenBlockingDefects(taskId, tenantId);
    if (openDefects.length === 0) {
      return;
    }
    const label = openDefects.length === 1 ? 'Defect' : 'Defects';
    const ids = openDefects.map((d) => `#${d.id}`).join(', ');
    throw new BadRequestException(`Cannot submit for QA - blocked by unresolved ${label} ${ids}. Resolve it first.`);
  }

  private async findOpenBlockingDefects(taskId: number, tenantId: number): Promise<ProjectTask[]> {
    const links = await this.blockingDefectsRepository.find({ where: { taskId, tenantId } });
    const linkedIds = links.map((l) => l.defectId);
    const where: Record<string, any>[] = [{ parentTaskId: taskId }];
    if (linkedIds.length > 0) {
      where.push({ id: In(linkedIds) });
    }
    const defects = await this.tasksRepository.find({
      where: where.map((w) => ({ ...w, tenantId, isDefect: true, status: Not(In(LINKED_DEFECT_RESOLVED_STATUSES)) })),
      order: { id: 'ASC' },
    });
    return defects;
  }

  // Combined task detail view - every defect ever spun off this task via
  // the QA-rejection "Create linked defect" option, most recent first.
  // Same visibility rule as the parent task itself, enforced by the
  // caller (TasksController.findLinkedDefects) via canView(), same
  // pattern as TaskDependencyTicketsService.findForTask().
  findLinkedDefectsForTask(parentTaskId: number, tenantId: number): Promise<ProjectTask[]> {
    return this.tasksRepository.find({ where: { parentTaskId, tenantId }, order: { createdAt: 'DESC' } });
  }

  private isInAssignedProject(task: ProjectTask, user: UserWithProjects): boolean {
    return (user.projects || []).some((p) => p.id === task.projectId);
  }

  // QA is scoped to their assigned projects; Program Manager is
  // tenant-wide. Caller has already checked ROLES_ALLOWED_TO_LINK_BLOCKING_DEFECTS.
  private assertCanLinkWithin(task: ProjectTask, user: UserWithProjects): void {
    if (user.role === UserRole.QA && !this.isInAssignedProject(task, user)) {
      throw new ForbiddenException(`Task #${task.id} is not in a project you're assigned to.`);
    }
  }

  // Defects QA/PM manually linked as blocking this task (not the
  // parentTaskId spun-off ones - those come from findLinkedDefectsForTask()).
  async findBlockingDefectsForTask(taskId: number, tenantId: number) {
    const links = await this.blockingDefectsRepository.find({ where: { taskId, tenantId }, order: { createdAt: 'DESC' } });
    const defects = await this.findManyByIds(links.map((l) => l.defectId), tenantId);
    const defectById = new Map(defects.map((d) => [d.id, d]));
    return links
      .filter((l) => defectById.has(l.defectId))
      .map((l) => {
        const d = defectById.get(l.defectId);
        return {
          id: d.id,
          title: d.title,
          status: d.status,
          assigneeEmail: d.assigneeEmail,
          linkedByEmail: l.linkedByEmail,
          linkedAt: l.createdAt,
        };
      });
  }

  // Reverse view for a defect's own page ("Blocks Task #70") - the task it
  // was spun off (parentTaskId, if any) plus every task it's been
  // manually linked to.
  async findTasksBlockedByDefect(defect: ProjectTask, tenantId: number) {
    const links = await this.blockingDefectsRepository.find({ where: { defectId: defect.id, tenantId } });
    const taskIds = links.map((l) => l.taskId);
    if (defect.parentTaskId) {
      taskIds.push(defect.parentTaskId);
    }
    const tasks = await this.findManyByIds([...new Set(taskIds)], tenantId);
    return tasks
      .sort((a, b) => a.id - b.id)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        linkType: t.id === defect.parentTaskId ? 'spun-off' : 'manual',
      }));
  }

  // Options for the link pickers - unresolved defects (task page) or
  // open, non-defect tasks (defect page), within the user's scope.
  async findBlockingLinkCandidates(kind: 'defects' | 'tasks', user: UserWithProjects, tenantId: number) {
    const where: Record<string, any> =
      kind === 'defects'
        ? { tenantId, isDefect: true, status: Not(In(LINKED_DEFECT_RESOLVED_STATUSES)) }
        : { tenantId, isDefect: false, status: Not(In([...COMPLETED_STATUSES, 'Closed'])) };
    if (user.role === UserRole.QA) {
      const projectIds = (user.projects || []).map((p) => p.id);
      if (projectIds.length === 0) return [];
      where.projectId = In(projectIds);
    }
    const rows = await this.tasksRepository.find({ where, order: { id: 'DESC' } });
    return rows.map((t) => ({ id: t.id, title: t.title, status: t.status, projectName: t.projectName }));
  }

  async linkBlockingDefect(taskId: number, defectId: number, user: UserWithProjects, tenantId: number): Promise<TaskBlockingDefect> {
    const task = await this.findOne(taskId, tenantId);
    const defect = await this.findOne(defectId, tenantId);
    if (task.isDefect) {
      throw new BadRequestException('A blocking defect can only be linked to a regular task, not to another defect.');
    }
    if (!defect.isDefect) {
      throw new BadRequestException(`#${defect.id} is not a Defect.`);
    }
    this.assertCanLinkWithin(task, user);
    this.assertCanLinkWithin(defect, user);
    if (LINKED_DEFECT_RESOLVED_STATUSES.includes(defect.status)) {
      throw new BadRequestException(`Defect #${defect.id} is already resolved (${defect.status}) - it can't block a task.`);
    }
    if (defect.parentTaskId === task.id) {
      throw new BadRequestException(`Defect #${defect.id} was raised from this task and already blocks it.`);
    }
    const existing = await this.blockingDefectsRepository.findOne({ where: { taskId, defectId, tenantId } });
    if (existing) {
      throw new BadRequestException(`Defect #${defect.id} is already linked to this task.`);
    }

    const saved = await this.blockingDefectsRepository.save(
      this.blockingDefectsRepository.create({
        tenantId,
        taskId,
        defectId,
        linkedByUserId: user.id,
        linkedByEmail: user.email,
      }),
    );
    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TASK_BLOCKING_DEFECT_LINKED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: { defectId },
    });
    return saved;
  }

  async unlinkBlockingDefect(taskId: number, defectId: number, user: UserWithProjects, tenantId: number): Promise<void> {
    const task = await this.findOne(taskId, tenantId);
    this.assertCanLinkWithin(task, user);
    const existing = await this.blockingDefectsRepository.findOne({ where: { taskId, defectId, tenantId } });
    if (!existing) {
      throw new NotFoundException(`Defect #${defectId} is not linked to this task.`);
    }
    await this.blockingDefectsRepository.remove(existing);
    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TASK_BLOCKING_DEFECT_UNLINKED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: taskId,
      details: { defectId },
    });
  }

  // Stable sort (Array.prototype.sort's guaranteed since ES2019) - tasks
  // sharing a priority (including two unset ones) keep whatever relative
  // order the caller's own query already put them in (e.g. createdAt DESC),
  // so this only ever reorders across priority tiers, never within one.
  private sortByPriority<T extends { priority?: TaskPriority | null }>(tasks: T[]): T[] {
    return [...tasks].sort((a, b) => (PRIORITY_RANK[a.priority as string] ?? 3) - (PRIORITY_RANK[b.priority as string] ?? 3));
  }

  private async withComputedFields(
    task: ProjectTask,
    tenantId: number,
    percentByStatus?: Record<string, number>,
    fullNameByUserId?: Map<number, string>,
  ): Promise<ProjectTaskWithComputed> {
    const map = percentByStatus ?? (await this.taskStatusConfigService.percentByStatus(tenantId));
    const percentComplete = task.status != null ? map[task.status] ?? null : null;
    const ageingDays = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / MS_PER_DAY);
    const assigneeFullName = task.assigneeUserId != null ? fullNameByUserId?.get(task.assigneeUserId) : undefined;
    return { ...task, percentComplete, ageingDays, assigneeFullName };
  }

  // Batch lookup for withComputedFields()'s assigneeFullName - one query
  // per queue fetch instead of one per row.
  private async fullNameByUserId(tasks: ProjectTask[], tenantId: number): Promise<Map<number, string>> {
    const ids = Array.from(new Set(tasks.map((t) => t.assigneeUserId).filter((id): id is number => id != null)));
    const users = await this.usersService.findByIds(ids, tenantId);
    return new Map(users.map((u) => [u.id, u.fullName]));
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
  // `showHoldClosed` - same default-hide-then-reveal toggle as Team Tasks
  // (TeamTaskFilters.showHoldClosed / defaultHiddenStatuses() above),
  // scoped to just Hold/Closed here since an unassigned Backlog task is
  // never in a COMPLETED_STATUSES status in practice (it hasn't started).
  async findBacklog(tenantId: number, showHoldClosed?: boolean): Promise<ProjectTaskWithComputed[]> {
    const where: Record<string, any> = { tenantId, assigneeUserId: IsNull() };
    if (!showHoldClosed) {
      where.status = Not(In(HOLD_CLOSED_STATUSES));
    }
    const tasks = this.sortByPriority(
      await this.tasksRepository.find({
        where,
        order: { createdAt: 'DESC' },
      }),
    );
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
    const pendingTasks = this.sortByPriority(
      await this.tasksRepository.find({
        where: { tenantId, isDefect: false, status: In(QA_PENDING_STATUSES) },
        order: { createdAt: 'DESC' },
      }),
    );
    const today = new Date().toISOString().slice(0, 10);
    const statCounts = {
      pending: pendingTasks.length,
      resubmissions: pendingTasks.filter((t) => t.status === 'Re-Feedback').length,
      // qaReviewDueDate, not the Assignee's own dueDate - pendingTasks is
      // already scoped to Feedback/Re-Feedback, so no extra status check
      // is needed here (contrast with the frontend's isQaReviewOverdue()
      // helper, which isn't scoped to a single status list up front).
      overdue: pendingTasks.filter((t) => t.qaReviewDueDate && t.qaReviewDueDate < today).length,
      approved: await this.tasksRepository.count({ where: { tenantId, isDefect: false, status: 'Pass' } }),
      rejected: await this.tasksRepository.count({ where: { tenantId, isDefect: false, status: 'Failed' } }),
    };

    let tasks: ProjectTask[];
    if (status === 'Pass' || status === 'Failed') {
      tasks = this.sortByPriority(
        await this.tasksRepository.find({ where: { tenantId, isDefect: false, status }, order: { createdAt: 'DESC' } }),
      );
    } else if (status === 'Feedback' || status === 'Re-Feedback') {
      tasks = pendingTasks.filter((t) => t.status === status);
    } else {
      tasks = pendingTasks;
    }

    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    const fullNameByUserId = await this.fullNameByUserId(tasks, tenantId);
    const withComputed = await Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus, fullNameByUserId)));
    return { tasks: withComputed, statCounts };
  }

  // Defect queue - the mirror image of findQaQueue() above. For QA it's
  // self-scoped to the QA user who raised the defect (createdByUserId),
  // same self-scoping reasoning as findPeerReviewQueue() (just keyed off
  // createdByUserId instead of TaskQaReview.reviewerUserId, since a
  // defect's "reviewer" is fixed at creation time, not picked at submit
  // time). Admin/Program Manager have no "my own defects" concept, so for
  // them this is tenant-wide instead, mirroring every QA person's defects -
  // same view-only leadership grant the rest of Tasks gives them. Same
  // shape (QaQueueResult) so the frontend can reuse QaReviewWorkboard's
  // cards/table/filters unchanged.
  async findDefectQueue(currentUser: { id: number; role: UserRole }, tenantId: number, status?: string): Promise<QaQueueResult> {
    const baseWhere =
      currentUser.role === UserRole.QA
        ? { tenantId, isDefect: true, createdByUserId: currentUser.id }
        : { tenantId, isDefect: true };
    // "Pending"/open here means OPEN_DEFECT_STATUSES (Development through
    // Escalated), not QA_PENDING_STATUSES - unlike findQaQueue() above, a
    // defect needs to stay visible to the QA who raised it the whole time
    // it's open, not just while a QA review round is actually pending.
    const openTasks = await this.tasksRepository.find({
      where: { ...baseWhere, status: In(OPEN_DEFECT_STATUSES) },
      order: { createdAt: 'DESC' },
    });
    const today = new Date().toISOString().slice(0, 10);
    const statCounts = {
      pending: openTasks.length,
      resubmissions: openTasks.filter((t) => t.status === 'Re-Feedback').length,
      // Same qaReviewDueDate switch as findQaQueue() above - a defect
      // still sitting at 'Development' (not yet submitted) has no
      // qaReviewDueDate yet, so it's naturally excluded here rather than
      // needing its own status check.
      overdue: openTasks.filter((t) => t.qaReviewDueDate && t.qaReviewDueDate < today).length,
      approved: await this.tasksRepository.count({ where: { ...baseWhere, status: 'Pass' } }),
      rejected: await this.tasksRepository.count({ where: { ...baseWhere, status: 'Failed' } }),
    };

    let tasks: ProjectTask[];
    if (status === 'Pass' || status === 'Failed') {
      tasks = await this.tasksRepository.find({ where: { ...baseWhere, status }, order: { createdAt: 'DESC' } });
    } else if (OPEN_DEFECT_STATUSES.includes(status || '')) {
      tasks = openTasks.filter((t) => t.status === status);
    } else {
      tasks = openTasks;
    }

    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    const fullNameByUserId = await this.fullNameByUserId(tasks, tenantId);
    const withComputed = await Promise.all(tasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus, fullNameByUserId)));
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
    const tasks = this.sortByPriority(
      await this.tasksRepository.find({
        where: { tenantId, assigneeUserId: currentUser.id },
        order: { createdAt: 'DESC' },
      }),
    );
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
  // Combines the two independent "hidden by default, toggle to reveal"
  // filters (showCompleted for Pass/Junk/Released, showHoldClosed for
  // Hold/Closed) into one exclusion list for a `where`/`cardWhere` clause.
  // Kept as its own method so findTeam()'s two call sites (the paginated
  // row fetch and the stat-card scope) and findBacklog() below can't drift
  // apart from each other.
  private defaultHiddenStatuses(filters: { showCompleted?: boolean; showHoldClosed?: boolean }): string[] {
    return [
      ...(filters.showCompleted ? [] : COMPLETED_STATUSES),
      ...(filters.showHoldClosed ? [] : HOLD_CLOSED_STATUSES),
    ];
  }

  async findTeam(tenantId: number, filters: TeamTaskFilters): Promise<TeamTasksResult> {
    const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(Math.floor(filters.pageSize), 200) : 50;

    const where: Record<string, any> = { tenantId, assigneeUserId: Not(IsNull()) };
    if (filters.status && filters.status !== 'All') {
      const statusList = filters.status.split(',').map((s) => s.trim()).filter(Boolean);
      where.status = In(statusList);
    } else {
      const hidden = this.defaultHiddenStatuses(filters);
      if (hidden.length > 0) where.status = Not(In(hidden));
    }
    if (filters.assigneeUserId) {
      where.assigneeUserId = filters.assigneeUserId;
    }
    if (filters.phaseId) {
      where.phaseId = filters.phaseId;
    }
    if (filters.isDefect === 'Yes') {
      where.isDefect = true;
    } else if (filters.isDefect === 'No') {
      where.isDefect = false;
    }
    if (filters.dueFrom && filters.dueTo) {
      where.dueDate = Between(filters.dueFrom, filters.dueTo);
    } else if (filters.dueFrom) {
      where.dueDate = MoreThanOrEqual(filters.dueFrom);
    } else if (filters.dueTo) {
      where.dueDate = LessThanOrEqual(filters.dueTo);
    }

    const matching = this.sortByPriority(await this.tasksRepository.find({ where, order: { createdAt: 'DESC' } }));
    const openDependencyIds = await this.findOpenDependencyTaskIds(matching.map((t) => t.id));

    let filtered = matching;
    if (filters.dependency === 'Yes') {
      filtered = filtered.filter((t) => openDependencyIds.has(t.id));
    } else if (filters.dependency === 'No') {
      filtered = filtered.filter((t) => !openDependencyIds.has(t.id));
    }

    const dependencyRows = await this.findTeamDependencyRows(tenantId, filters.assigneeUserId);
    const includedDependencyRows = filters.includeDependencies ? dependencyRows : [];

    // Dependencies first, then tasks in their usual priority order -
    // paginated as one list so page counts stay honest.
    const combined: Array<TeamDependencyRow | ProjectTask> = [...includedDependencyRows, ...filtered];
    const total = combined.length;
    const start = (page - 1) * pageSize;
    const pageItems = filters.all ? combined : combined.slice(start, start + pageSize);
    const isDependencyRow = (item: TeamDependencyRow | ProjectTask): item is TeamDependencyRow =>
      (item as TeamDependencyRow).kind === 'dependency';
    const pageTasks = pageItems.filter((item): item is ProjectTask => !isDependencyRow(item));

    const percentByStatus = await this.taskStatusConfigService.percentByStatus(tenantId);
    const withComputed = await Promise.all(pageTasks.map((t) => this.withComputedFields(t, tenantId, percentByStatus)));
    const dependencyTicketsByTaskId = await this.findDependencyTicketsForTasks(pageTasks.map((t) => t.id));
    const computedById = new Map(
      withComputed.map((t) => [
        t.id,
        {
          ...t,
          hasOpenDependency: openDependencyIds.has(t.id),
          dependencyTickets: dependencyTicketsByTaskId.get(t.id) || [],
        },
      ]),
    );
    const tasks = pageItems.map((item) => (isDependencyRow(item) ? item : computedById.get(item.id)));

    const cardWhere: Record<string, any> = { tenantId, assigneeUserId: filters.assigneeUserId || Not(IsNull()) };
    const cardHidden = this.defaultHiddenStatuses(filters);
    if (cardHidden.length > 0) {
      cardWhere.status = Not(In(cardHidden));
    }
    const cardScopeTasks = await this.tasksRepository.find({ where: cardWhere });
    const cardOpenDependencyIds = await this.findOpenDependencyTaskIds(cardScopeTasks.map((t) => t.id));
    const today = new Date().toISOString().slice(0, 10);
    const statCounts = {
      total: cardScopeTasks.length,
      rejected: cardScopeTasks.filter((t) => t.status === 'Failed').length,
      openDependency: cardScopeTasks.filter((t) => cardOpenDependencyIds.has(t.id)).length,
      // Pass/Junk were already excluded from "overdue" - Hold/Closed get
      // the same treatment (see HOLD_CLOSED_STATUSES) so a task the PM
      // paused or force-closed never counts as overdue, even if
      // showHoldClosed is on and it's sitting in cardScopeTasks.
      overdue: cardScopeTasks.filter(
        (t) => t.dueDate && t.dueDate < today && !COMPLETED_STATUSES.includes(t.status) && !HOLD_CLOSED_STATUSES.includes(t.status),
      ).length,
      defects: cardScopeTasks.filter((t) => t.isDefect).length,
    };

    const assignees = await this.findTeamAssignees(tenantId);
    const phases = await this.findTeamPhases(tenantId);

    return {
      tasks,
      total,
      statCounts,
      assignees,
      phases,
      dependenciesToClearCount: dependencyRows.length,
      includedDependencyCount: includedDependencyRows.length,
    };
  }

  // See TeamDependencyRow. Only open tickets - a resolved ticket drops
  // out of the grid and the "N to clear" count. Every open ticket counts
  // regardless of its parent task's status (a ticket on a Hold/Closed task
  // is still open and still on the owner's plate - confirmed with the
  // user 2026-10). Keyed on the ticket's owner, never the parent task's
  // assignee - the owner is who TaskDependencyTicketsService.resolve()
  // expects to clear it.
  private async findTeamDependencyRows(tenantId: number, ownerUserId?: number): Promise<TeamDependencyRow[]> {
    const where: Record<string, any> = { tenantId, status: 'open' };
    if (ownerUserId) where.ownerUserId = ownerUserId;
    const tickets = await this.dependencyTicketsRepository.find({ where, order: { createdAt: 'ASC' } });
    if (tickets.length === 0) return [];
    const parentTasks = await this.findManyByIds([...new Set(tickets.map((t) => t.parentTaskId))], tenantId);
    const parentById = new Map(parentTasks.map((t) => [t.id, t]));
    const now = Date.now();
    return tickets.map((t) => {
      const parent = parentById.get(t.parentTaskId);
      return {
        kind: 'dependency' as const,
        id: t.id,
        title: t.title,
        status: 'Open' as const,
        assigneeUserId: t.ownerUserId,
        assigneeEmail: t.ownerEmail,
        createdByEmail: t.createdByEmail,
        createdAt: t.createdAt,
        ageingDays: Math.max(0, Math.floor((now - new Date(t.createdAt).getTime()) / MS_PER_DAY)),
        dueDate: parent?.dueDate ?? null,
        projectName: parent?.projectName ?? null,
        moduleName: parent?.moduleName ?? null,
        parentTaskId: t.parentTaskId,
        parentTaskTitle: parent?.title ?? null,
        priority: null,
        estimatedHours: null,
        percentComplete: null,
        hasOpenDependency: false as const,
      };
    });
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
  ): Promise<Map<number, Array<{ id: number; title: string; description: string; ownerEmail: string; status: string }>>> {
    const map = new Map<number, Array<{ id: number; title: string; description: string; ownerEmail: string; status: string }>>();
    if (taskIds.length === 0) return map;
    const tickets = await this.dependencyTicketsRepository.find({ where: { parentTaskId: In(taskIds) } });
    for (const ticket of tickets) {
      const existing = map.get(ticket.parentTaskId) || [];
      existing.push({ id: ticket.id, title: ticket.title, description: ticket.description, ownerEmail: ticket.ownerEmail, status: ticket.status });
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
  //
  // The SMOKE_TEST_EMAIL account (same identifier NonComplianceReportService
  // uses) is always listed, last, whether or not it has assigned tasks - it
  // mostly owns dependency tickets, which don't qualify it above, and the
  // user wanted its chip pinned after everyone else (2026-10).
  private async findTeamAssignees(tenantId: number): Promise<Array<{ id: number; email: string; fullName: string | null }>> {
    const smokeTestEmail = process.env.SMOKE_TEST_EMAIL;
    const rows = await this.tasksRepository.find({
      where: { tenantId, assigneeUserId: Not(IsNull()) },
      select: ['assigneeUserId'],
    });
    const uniqueIds = Array.from(new Set(rows.map((r) => r.assigneeUserId)));
    const users = uniqueIds.length > 0 ? await this.usersService.findByIds(uniqueIds, tenantId) : [];
    const assignees = users
      .filter((u) => !smokeTestEmail || u.email !== smokeTestEmail)
      .map((u) => ({ id: u.id, email: u.email, fullName: u.fullName }))
      .sort((a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email));
    const smokeTestUser = smokeTestEmail ? await this.usersService.findByEmailAndTenant(smokeTestEmail, tenantId) : null;
    if (smokeTestUser) {
      assignees.push({ id: smokeTestUser.id, email: smokeTestUser.email, fullName: smokeTestUser.fullName });
    }
    return assignees;
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
    const fullNameByUserId = await this.fullNameByUserId([task], tenantId);
    return this.withComputedFields(task, tenantId, undefined, fullNameByUserId);
  }

  // Bulk lookup by id, no view-access filtering - callers are trusted
  // internal services (e.g. TaskDependencyTicketsService enriching a
  // ticket list with its parent task's Due Date) that already know these
  // ids are relevant, not a request handler exposing arbitrary tasks.
  findManyByIds(ids: number[], tenantId: number): Promise<ProjectTask[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.tasksRepository.find({ where: { id: In(ids), tenantId } });
  }

  // Developer/Designer/DevOps creating their own task (the top-bar "+"
  // shortcut): the assignee is always the creator - omitted defaults to
  // them, anyone else is rejected rather than silently overridden - and
  // the project must be one they're assigned to, same scoping GET
  // /projects already applies to them. Static so the regression suite can
  // exercise it without a full request.
  static applySelfCreateRules(dto: CreateTaskDto, user: { id: number; projects?: { id: number }[] }): CreateTaskDto {
    if (dto.assigneeUserId != null && dto.assigneeUserId !== user.id) {
      throw new ForbiddenException('You can only create tasks assigned to yourself. Ask a Program Manager to assign it to someone else.');
    }
    if (!(user.projects || []).some((p) => p.id === dto.projectId)) {
      throw new ForbiddenException("You can only create tasks in projects you're assigned to.");
    }
    return { ...dto, assigneeUserId: user.id };
  }

  // Stage 1: Program Manager creates a Backlog task - Project/Module/Phase/
  // Description, optionally with an Assignee set right away (skipping the
  // separate assign step). No E.Hrs, no Due Date yet either way. Status
  // starts at 'Development' immediately - it's never gated behind other
  // fields being set, since Status is auto-computed, not manually
  // unlocked.
  async create(dto: CreateTaskDto, user: { id: number; email: string }, tenantId: number): Promise<ProjectTask> {
    const { project, module, phase } = await this.resolveChain(dto.projectId, dto.moduleId, dto.phaseId, tenantId);

    let assignee: { id: number; email: string; role: UserRole } | null = null;
    if (dto.assigneeUserId != null) {
      assignee = await this.usersService.findByIdAndTenant(dto.assigneeUserId, tenantId);
      if (!assignee) {
        throw new NotFoundException(`User #${dto.assigneeUserId} not found`);
      }
    }

    const task = this.tasksRepository.create({
      projectId: project.id,
      projectName: project.name,
      moduleId: module.id,
      moduleName: module.name,
      phaseId: phase.id,
      phaseName: phase.name,
      title: dto.title.trim(),
      description: sanitizeRichText(dto.description),
      assigneeUserId: assignee?.id ?? null,
      assigneeEmail: assignee?.email ?? null,
      estimatedHours: null,
      dueDate: null,
      status: 'Development',
      // A QA-assigned task always goes through Peer Review, never the
      // shared QA queue - see the QA_ASSIGNEE_FORCES_PEER_REVIEW comment
      // on requiresPeerReviewForAssignee() below for why.
      peerReviewEnabled: this.requiresPeerReviewForAssignee(assignee?.role) || (dto.peerReviewEnabled ?? false),
      // Never auto-assigned - omitted means "Not Set" (null), same as an
      // existing task nobody has reviewed yet. A Developer/Designer/DevOps
      // creating their own task may set it too (confirmed with the user).
      priority: dto.priority ?? null,
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
      details: {
        projectId: saved.projectId,
        moduleId: saved.moduleId,
        phaseId: saved.phaseId,
        assigneeUserId: saved.assigneeUserId,
      },
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
  // parentTaskId is deliberately not a CreateDefectTaskDto field - it's
  // only ever passed by TaskQaReviewsService.reject()'s "Create linked
  // defect" option, using the parent task it already loaded and
  // tenant-checked, never accepted from the client directly (so a QA
  // filing a standalone defect from the Create Defect page has no way to
  // link it to an arbitrary task).
  async createDefect(
    dto: CreateDefectTaskDto,
    user: { id: number; email: string },
    tenantId: number,
    parentTaskId: number | null = null,
  ): Promise<ProjectTask> {
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
        title: dto.title.trim(),
        description: sanitizeRichText(dto.description),
        assigneeUserId: assignee.id,
        assigneeEmail: assignee.email,
        estimatedHours: null,
        dueDate: null,
        status: 'Development',
        peerReviewEnabled: false,
        isDefect: true,
        parentTaskId,
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
        parentTaskId,
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
    if (this.requiresPeerReviewForAssignee(assignee.role)) {
      task.peerReviewEnabled = true;
    }
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
  ): Promise<ProjectTask & { assigneeFullName?: string }> {
    const task = await this.findOne(id, tenantId);
    const previousAssigneeUserId = task.assigneeUserId;
    const previousAssigneeEmail = task.assigneeEmail;
    let assigneeFullName: string | undefined;

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
      assigneeFullName = assignee.fullName;
      if (this.requiresPeerReviewForAssignee(assignee.role)) {
        task.peerReviewEnabled = true;
      }
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

    return { ...saved, assigneeFullName };
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

  // Program Manager or Admin can pause any task, from any current status,
  // no reason/comment required (confirmed with the user 2026-09) - role
  // gating lives in the controller (ROLES_ALLOWED_TO_SET_HOLD_CLOSED),
  // same "narrow exception via its own endpoint" shape as
  // setPeerReviewFlag()/setQaReviewDueDate() above, since Admin is
  // otherwise view-only across Tasks. Records priorStatus so
  // releaseTask() below can resume the task exactly where it left off.
  async holdTask(
    id: number,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (task.status === 'Hold') {
      throw new BadRequestException('This task is already on Hold.');
    }
    if (task.status === 'Closed') {
      throw new BadRequestException('This task is Closed - it cannot be put on Hold.');
    }

    const previousStatus = task.status;
    task.priorStatus = previousStatus;
    task.status = 'Hold';
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_HELD,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { previousStatus },
    });

    return saved;
  }

  // The other half of holdTask() above - resumes the task at whatever
  // status it was in right before Hold. Falls back to 'Development' only
  // if priorStatus is somehow missing (defensive - every path that sets
  // 'Hold' also sets priorStatus in the same save).
  async releaseTask(
    id: number,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (task.status !== 'Hold') {
      throw new BadRequestException('Only a task on Hold can be released this way.');
    }

    const restoredStatus = task.priorStatus || 'Development';
    task.status = restoredStatus;
    task.priorStatus = null;
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_RELEASED_FROM_HOLD,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { restoredStatus },
    });

    return saved;
  }

  // Program Manager or Admin force-closes any task, from any current
  // status, regardless of resolution state - distinct from Pass (normally
  // resolved) and from Junk (closeAsJunk() above, which only applies to an
  // escalated ticket PM decided was never a real issue). Terminal, same as
  // Junk except that reopenTask() below can undo it. No reason/comment
  // required, same as holdTask() above. Keeps priorStatus as the status to
  // reopen to - for a task closed while on Hold, that's the status it had
  // before Hold (reopening resumes work rather than re-pausing it).
  async closeTask(
    id: number,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (task.status === 'Closed') {
      throw new BadRequestException('This task is already Closed.');
    }

    const previousStatus = task.status;
    task.priorStatus = previousStatus === 'Hold' ? task.priorStatus || 'Development' : previousStatus;
    task.status = 'Closed';
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_CLOSED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { previousStatus },
    });

    return saved;
  }

  // Undoes closeTask() above - restores the task to the status it had
  // before it was closed. Tasks closed before closeTask() started keeping
  // priorStatus fall back to the TASK_CLOSED audit entry's previousStatus
  // (resolved past Hold the same way), then 'Development'. Same role gate
  // as hold/release/close (ROLES_ALLOWED_TO_SET_HOLD_CLOSED).
  async reopenTask(
    id: number,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (task.status !== 'Closed') {
      throw new BadRequestException('Only a Closed task can be reopened.');
    }

    let restoredStatus = task.priorStatus;
    if (!restoredStatus) {
      const closedDetails = await this.auditLogService.findLatestDetails(
        tenantId,
        AuditActions.TASK_CLOSED,
        'ProjectTask',
        task.id,
      );
      const closedFrom = closedDetails?.previousStatus;
      if (typeof closedFrom === 'string' && closedFrom !== 'Hold' && closedFrom !== 'Closed') {
        restoredStatus = closedFrom;
      } else if (closedFrom === 'Hold') {
        const heldDetails = await this.auditLogService.findLatestDetails(
          tenantId,
          AuditActions.TASK_HELD,
          'ProjectTask',
          task.id,
        );
        const heldFrom = heldDetails?.previousStatus;
        if (typeof heldFrom === 'string' && heldFrom !== 'Hold' && heldFrom !== 'Closed') {
          restoredStatus = heldFrom;
        }
      }
    }
    restoredStatus = restoredStatus || 'Development';

    task.status = restoredStatus;
    task.priorStatus = null;
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_REOPENED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { restoredStatus },
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
    // A Developer/Designer/DevOps assigned to the task may edit its
    // Description (only - Project/Module/Phase/Title stay PM-only).
    const isDeveloperAssignee =
      DEVELOPER_EQUIVALENT_ROLES.includes(currentUser.role) && task.assigneeUserId === currentUser.id;
    if (!canMutate) {
      const attemptedBacklogField = BACKLOG_FIELDS.find(
        (field) => dto[field] !== undefined && !(field === 'description' && isDeveloperAssignee),
      );
      if (attemptedBacklogField && !isDefectRaiser) {
        throw new ForbiddenException('Only Program Manager can edit Project, Module, Phase, or Description.');
      }
      if (isDefectRaiser && (dto.estimatedHours !== undefined || dto.dueDate !== undefined)) {
        throw new ForbiddenException('QA cannot edit Estimated Hours or Due Date.');
      }
    }

    // Priority is Program Manager only - not even the task's own Assignee
    // or the QA who raised a defect (both of whom otherwise pass canEdit()
    // above) may set or change it.
    if (dto.priority !== undefined && !canMutate) {
      throw new ForbiddenException("Only Program Manager can set or change a task's priority.");
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

    if (dto.title !== undefined) task.title = dto.title.trim();
    if (dto.description !== undefined) task.description = sanitizeRichText(dto.description);
    if (dto.estimatedHours !== undefined) task.estimatedHours = dto.estimatedHours;
    if (dto.dueDate !== undefined) task.dueDate = dto.dueDate;
    if (dto.priority !== undefined) task.priority = dto.priority;

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

  // Dedicated setter for manually adjusting qaReviewDueDate after it was
  // auto-set (computeQaReviewDueDate() above) - same "separate from
  // update()/UpdateTaskDto/canEdit()" shape as setPeerReviewFlag() above,
  // so this one endpoint can grant QA and Admin a narrow write exception
  // (QA otherwise has no edit rights on a task it doesn't own; Admin is
  // view-only everywhere else on Tasks) without touching the general edit
  // path's authorization at all. Role gating itself lives in
  // TasksController (ROLES_ALLOWED_TO_SET_QA_REVIEW_DUE_DATE).
  async setQaReviewDueDate(
    id: number,
    qaReviewDueDate: string,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<ProjectTask> {
    const task = await this.findOne(id, tenantId);
    if (task.qaReviewDueDate === qaReviewDueDate) {
      return task;
    }

    const previous = task.qaReviewDueDate;
    task.qaReviewDueDate = qaReviewDueDate;
    const saved = await this.tasksRepository.save(task);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.TASK_QA_REVIEW_DUE_DATE_EDITED,
      tenantId,
      entityType: 'ProjectTask',
      entityId: saved.id,
      details: { previousQaReviewDueDate: previous, newQaReviewDueDate: saved.qaReviewDueDate },
    });

    return saved;
  }
}
