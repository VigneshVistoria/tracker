import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { BulkAssignTasksDto } from './dto/bulk-assign-tasks.dto';
import { SetPeerReviewFlagDto } from './dto/set-peer-review-flag.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

const ROLES_ALLOWED_TO_CREATE_TASKS: UserRole[] = [UserRole.PROGRAM_MANAGER];
// Assigning (single or bulk) is a mutation, not a view - Program Manager
// only. Admin can still see the Backlog (ROLES_ALLOWED_TO_VIEW_BACKLOG
// below) but, like Executive, has view-only access to the Task workflow -
// it cannot create, assign, edit, or change the status of a task (the
// matching restriction lives in TasksService.canEdit()).
const ROLES_ALLOWED_TO_ASSIGN_TASKS: UserRole[] = [UserRole.PROGRAM_MANAGER];
const ROLES_ALLOWED_TO_VIEW_BACKLOG: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
const ROLES_ALLOWED_TO_VIEW_QA_QUEUE: UserRole[] = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.PROGRAM_MANAGER, UserRole.QA];
// Peer Review queue is self-scoped to the reviewer (TasksService.
// findPeerReviewQueue()), so only Developers - the only role that can be
// picked as a reviewer - need to see it.
const ROLES_ALLOWED_TO_VIEW_PEER_REVIEW_QUEUE: UserRole[] = [UserRole.DEVELOPER];
// Narrow, explicit exception: Admin has view-only access to every other
// task field/endpoint (see TasksService.canEdit()'s MUTATE_ROLES comment),
// but the Peer Review checkbox is deliberately PM-or-Admin per the
// workflow spec. Scoped to exactly this one field via its own endpoint/
// DTO/service method (setPeerReviewFlag) rather than adding Admin to
// MUTATE_ROLES, so nothing else about Admin's task permissions changes.
const ROLES_ALLOWED_TO_SET_PEER_REVIEW_FLAG: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];

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
  async findBacklog(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW_BACKLOG.includes(currentUser.role)) {
      throw new ForbiddenException('Only Admin and Program Manager can view the Task Backlog.');
    }
    return this.tasksService.findBacklog(req.user.tenantId);
  }

  // QA Review queue - tasks with a QA review round pending. Declared
  // before ':id' for the same routing reason as 'backlog'/'mine' above.
  @Get('qa-queue')
  async findQaQueue(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_VIEW_QA_QUEUE.includes(currentUser.role)) {
      throw new ForbiddenException('Only QA, Admin, Executive, or Program Manager can view the QA Review queue.');
    }
    return this.tasksService.findQaQueue(req.user.tenantId);
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

  // My Tasks - tasks assigned to the current user.
  @Get('mine')
  async findMine(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.tasksService.findMine(currentUser, req.user.tenantId);
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

  @Post()
  async create(@Body() dto: CreateTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_CREATE_TASKS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager can create tasks.');
    }
    return this.tasksService.create(dto, currentUser, req.user.tenantId);
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
