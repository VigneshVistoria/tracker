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

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.tasksService.update(id, dto, currentUser, req.user.tenantId);
  }
}
