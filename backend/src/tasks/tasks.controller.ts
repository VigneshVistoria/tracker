import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateDefectTaskDto } from './dto/create-defect-task.dto';
import { ReassignEscalatedTaskDto } from './dto/reassign-escalated-task.dto';
import { ReassignTeamTaskDto } from './dto/reassign-team-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { BulkAssignTasksDto } from './dto/bulk-assign-tasks.dto';
import { SetPeerReviewFlagDto } from './dto/set-peer-review-flag.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';

const ROLES_ALLOWED_TO_CREATE_TASKS: UserRole[] = [UserRole.PROGRAM_MANAGER];
// Create Defect skips the Task Backlog entirely and assigns a Developer
// up front - QA only, matching who raises/owns a defect. Deliberately not
// Admin - Admin stays view-only across Tasks (MUTATE_ROLES comment in
// TasksService), same restriction as regular task creation above.
const ROLES_ALLOWED_TO_CREATE_DEFECTS: UserRole[] = [UserRole.QA];
// Viewing the Defect queue (My Defects) is wider than creating one - QA
// sees their own (TasksService.findDefectQueue() self-scopes them), Admin
// and Program Manager see every QA person's defects tenant-wide (same
// view-only leadership grant the rest of Tasks gives them elsewhere).
const ROLES_ALLOWED_TO_VIEW_DEFECT_QUEUE: UserRole[] = [UserRole.QA, UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
// Assigning (single or bulk) is a mutation, not a view - Program Manager
// only. Admin can still see the Backlog (ROLES_ALLOWED_TO_VIEW_BACKLOG
// below) but, like Executive, has view-only access to the Task workflow -
// it cannot create, assign, edit, or change the status of a task (the
// matching restriction lives in TasksService.canEdit()).
const ROLES_ALLOWED_TO_ASSIGN_TASKS: UserRole[] = [UserRole.PROGRAM_MANAGER];
const ROLES_ALLOWED_TO_VIEW_BACKLOG: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
// Escalation queue: same view/mutate split as Task Backlog above - Admin
// can view it, only Program Manager can act (reassign/close as Junk).
const ROLES_ALLOWED_TO_VIEW_ESCALATIONS: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
const ROLES_ALLOWED_TO_ACT_ON_ESCALATIONS: UserRole[] = [UserRole.PROGRAM_MANAGER];
const ROLES_ALLOWED_TO_VIEW_QA_QUEUE: UserRole[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.PROGRAM_MANAGER, UserRole.QA];
// Peer Review queue is self-scoped to the reviewer (TasksService.
// findPeerReviewQueue()), so only Developer/Designer/DevOps - the only
// roles that can be picked as a reviewer - need to see it.
const ROLES_ALLOWED_TO_VIEW_PEER_REVIEW_QUEUE: UserRole[] = DEVELOPER_EQUIVALENT_ROLES;
// Narrow, explicit exception: Admin has view-only access to every other
// task field/endpoint (see TasksService.canEdit()'s MUTATE_ROLES comment),
// but the Peer Review checkbox is deliberately PM-or-Admin per the
// workflow spec. Scoped to exactly this one field via its own endpoint/
// DTO/service method (setPeerReviewFlag) rather than adding Admin to
// MUTATE_ROLES, so nothing else about Admin's task permissions changes.
const ROLES_ALLOWED_TO_SET_PEER_REVIEW_FLAG: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
// Same "narrow exception via its own endpoint/DTO/service method" shape
// as ROLES_ALLOWED_TO_SET_PEER_REVIEW_FLAG above - Hold/Closed is a
// deliberate, confirmed carve-out of Admin's otherwise view-only access
// to Tasks (MUTATE_ROLES in TasksService), scoped to exactly these four
// endpoints (hold/release/close/reopen) and nothing else about Admin's
// task permissions.
const ROLES_ALLOWED_TO_SET_HOLD_CLOSED: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
// Team Tasks - view-only for Admin/Executive, same leadership-wide grant
// findAllForUser() gives them (TasksService.LEADERSHIP_ROLES); edit rights
// on any task opened from this screen still go through the general
// canEdit()/MUTATE_ROLES check on the task detail page, unchanged - this
// array only controls who can load the Team Tasks list itself.
const ROLES_ALLOWED_TO_VIEW_TEAM_TASKS: UserRole[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.PROGRAM_MANAGER];

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(
    private tasksService: TasksService,
    private usersService: UsersService,
  ) {}

  @Get()
  async findAll(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.tasksService.findAllForUser(currentUser, req.user.tenantId);
  }

  // Task Backlog - unassigned tasks. Declared before ':id' for the same
  // routing reason as issues/dependencies/received.
  @Get('backlog')
  async findBacklog(@Query('showHoldClosed') showHoldClosed: string | undefined, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW_BACKLOG.includes(currentUser.role)) {
      throw new ForbiddenException('Only Admin and Program Manager can view the Task Backlog.');
    }
    return this.tasksService.findBacklog(req.user.tenantId, showHoldClosed === 'true');
  }

  // QA Review queue - tasks with a QA review round pending by default, or
  // (via ?status=) already-decided tasks the queue's Approved/Rejected
  // stat cards filter into. Declared before ':id' for the same routing
  // reason as 'backlog'/'mine' above.
  @Get('qa-queue')
  async findQaQueue(@Query('status') status: string | undefined, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW_QA_QUEUE.includes(currentUser.role)) {
      throw new ForbiddenException('Only QA, Admin, Executive, or Program Manager can view the QA Review queue.');
    }
    return this.tasksService.findQaQueue(req.user.tenantId, status);
  }

  // Peer Review queue - tasks with a Peer Review round pending, assigned
  // to the current user as reviewer. Declared before ':id' for the same
  // routing reason as 'backlog'/'qa-queue'/'mine'.
  @Get('peer-review-queue')
  async findPeerReviewQueue(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW_PEER_REVIEW_QUEUE.includes(currentUser.role)) {
      throw new ForbiddenException('Only Developers can view the Peer Review queue.');
    }
    return this.tasksService.findPeerReviewQueue(currentUser, req.user.tenantId);
  }

  // PM Escalation queue - tasks QA escalated instead of Approve/Reject.
  // Declared before ':id' for the same routing reason as 'backlog'/
  // 'qa-queue'/'peer-review-queue'/'defect-queue'/'mine'.
  @Get('escalations')
  async findEscalationQueue(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW_ESCALATIONS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Admin and Program Manager can view the Escalation queue.');
    }
    return this.tasksService.findEscalationQueue(req.user.tenantId);
  }

  // Defect queue - defect tickets with a QA review round pending. Self-
  // scoped to the QA user who raised them for QA (unlike qa-queue above,
  // which is tenant-wide), tenant-wide for Admin/Program Manager (see
  // TasksService.findDefectQueue()). Declared before ':id' for the same
  // routing reason as 'backlog'/'qa-queue'/'peer-review-queue'/'mine'.
  @Get('defect-queue')
  async findDefectQueue(@Query('status') status: string | undefined, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW_DEFECT_QUEUE.includes(currentUser.role)) {
      throw new ForbiddenException('Only QA, Admin, or Program Manager can view the Defect queue.');
    }
    return this.tasksService.findDefectQueue(currentUser, req.user.tenantId, status);
  }

  // My Tasks - tasks assigned to the current user.
  @Get('mine')
  async findMine(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.tasksService.findMine(currentUser, req.user.tenantId);
  }

  // Team Tasks - every team member's assigned tasks in one place.
  // Declared before ':id' for the same routing reason as 'backlog'/
  // 'qa-queue'/'peer-review-queue'/'mine' above.
  @Get('team')
  async findTeam(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Query('assigneeUserId') assigneeUserId: string | undefined,
    @Query('phaseId') phaseId: string | undefined,
    @Query('dependency') dependency: string | undefined,
    @Query('isDefect') isDefect: string | undefined,
    @Query('dueFrom') dueFrom: string | undefined,
    @Query('dueTo') dueTo: string | undefined,
    @Query('showCompleted') showCompleted: string | undefined,
    @Query('showHoldClosed') showHoldClosed: string | undefined,
    @Query('all') all: string | undefined,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW_TEAM_TASKS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Admin, Executive, or Program Manager can view Team Tasks.');
    }
    return this.tasksService.findTeam(req.user.tenantId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status,
      assigneeUserId: assigneeUserId ? Number(assigneeUserId) : undefined,
      phaseId: phaseId ? Number(phaseId) : undefined,
      dependency,
      isDefect,
      dueFrom,
      dueTo,
      showCompleted: showCompleted === 'true',
      showHoldClosed: showHoldClosed === 'true',
      all: all === 'true',
    });
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(id, req.user.tenantId);
    if (!(await this.tasksService.canView(task, currentUser))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return this.tasksService.findOneWithComputed(id, req.user.tenantId);
  }

  // Evidence QA attached at Create Defect time - same view gate as the
  // task itself.
  @Get(':id/defect-artifacts')
  async findDefectArtifacts(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(id, req.user.tenantId);
    if (!(await this.tasksService.canView(task, currentUser))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return this.tasksService.findDefectArtifacts(id);
  }

  // Defects spun off this task via QA-rejection's "Create linked defect"
  // option - same view gate as the task itself and the Dependency Ticket
  // equivalent (TaskDependencyTicketsController.findForTask).
  @Get(':id/linked-defects')
  async findLinkedDefects(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(id, req.user.tenantId);
    if (!(await this.tasksService.canView(task, currentUser))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return this.tasksService.findLinkedDefectsForTask(id, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_CREATE_TASKS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager can create tasks.');
    }
    return this.tasksService.create(dto, currentUser, req.user.tenantId);
  }

  // Create Defect - standalone, no Task Backlog step, assignee set at
  // creation time. Declared as its own path (not reusing POST /tasks)
  // since it takes a different DTO (assigneeUserId required).
  @Post('defects')
  async createDefect(@Body() dto: CreateDefectTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_CREATE_DEFECTS.includes(currentUser.role)) {
      throw new ForbiddenException('Only QA can create a defect ticket.');
    }
    return this.tasksService.createDefect(dto, currentUser, req.user.tenantId);
  }

  // Bulk assign - declared before ':id' so 'bulk-assign' isn't swallowed by
  // the ':id' pattern below.
  @Patch('bulk-assign')
  async bulkAssign(@Body() dto: BulkAssignTasksDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_ASSIGN_TASKS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager can assign tasks.');
    }
    return this.tasksService.bulkAssignTasks(dto.taskIds, dto.assigneeUserId, currentUser, req.user.tenantId);
  }

  @Patch(':id/assign')
  async assign(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_ASSIGN_TASKS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager can assign tasks.');
    }
    return this.tasksService.assignTask(id, dto.assigneeUserId, currentUser, req.user.tenantId);
  }

  // Team Tasks - PM edits the Assignee directly (pick a new one, or clear
  // it to send the task back to the Task Backlog). Program Manager only,
  // same gate as the assign/bulk-assign endpoints above - Admin stays
  // view-only across Tasks, same as everywhere else in this module.
  @Patch(':id/reassign')
  async reassignTeamTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReassignTeamTaskDto,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_ASSIGN_TASKS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager can reassign tasks.');
    }
    return this.tasksService.reassignTeamTask(id, dto, currentUser, req.user.tenantId);
  }

  // PM Escalation queue, option (a) - reassign to any Developer, Program
  // Manager only (Admin stays view-only, same split as everywhere else in
  // Tasks).
  @Patch(':id/escalation-reassign')
  async reassignEscalatedTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReassignEscalatedTaskDto,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_ACT_ON_ESCALATIONS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager can reassign an escalated task.');
    }
    return this.tasksService.reassignEscalatedTask(id, dto, currentUser, req.user.tenantId);
  }

  // PM Escalation queue, option (b) - close as Junk, Program Manager only.
  @Patch(':id/escalation-junk')
  async closeAsJunk(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_ACT_ON_ESCALATIONS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager can close an escalated task as Junk.');
    }
    return this.tasksService.closeAsJunk(id, currentUser, req.user.tenantId);
  }

  // Program Manager or Admin puts any task on Hold, from any current
  // status, no reason/comment required. Program Manager or Admin only -
  // see ROLES_ALLOWED_TO_SET_HOLD_CLOSED above.
  @Patch(':id/hold')
  async holdTask(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_SET_HOLD_CLOSED.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager or Admin can put a task on Hold.');
    }
    return this.tasksService.holdTask(id, currentUser, req.user.tenantId);
  }

  // Releases a task from Hold, resuming it at whatever status it was in
  // beforehand (TasksService.releaseTask()). Same role gate as hold above.
  @Patch(':id/release')
  async releaseTask(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_SET_HOLD_CLOSED.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager or Admin can release a task from Hold.');
    }
    return this.tasksService.releaseTask(id, currentUser, req.user.tenantId);
  }

  // Program Manager or Admin force-closes any task, from any current
  // status, regardless of resolution state - no reason/comment required.
  // Distinct from escalation-junk above (Program Manager only, and only
  // from Escalated). Same role gate as hold/release above.
  @Patch(':id/close')
  async closeTask(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_SET_HOLD_CLOSED.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager or Admin can close a task.');
    }
    return this.tasksService.closeTask(id, currentUser, req.user.tenantId);
  }

  // Reopens a Closed task at the status it had before it was closed
  // (TasksService.reopenTask()). Same role gate as hold/release/close.
  @Patch(':id/reopen')
  async reopenTask(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_SET_HOLD_CLOSED.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager or Admin can reopen a task.');
    }
    return this.tasksService.reopenTask(id, currentUser, req.user.tenantId);
  }

  // Dedicated endpoint for the Peer Review checkbox on an already-existing
  // task - Program Manager or Admin only (the one narrow exception to
  // Admin's view-only access to tasks). Kept separate from the general
  // PATCH ':id'/UpdateTaskDto below so that endpoint's PM-or-Assignee
  // gating is never affected by this feature.
  @Patch(':id/peer-review-flag')
  async setPeerReviewFlag(@Param('id', ParseIntPipe) id: number, @Body() dto: SetPeerReviewFlagDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_SET_PEER_REVIEW_FLAG.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager or Admin can change the Peer Review setting.');
    }
    return this.tasksService.setPeerReviewFlag(id, dto.peerReviewEnabled, currentUser, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.tasksService.update(id, dto, currentUser, req.user.tenantId);
  }
}
