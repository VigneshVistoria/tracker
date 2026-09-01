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
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

const ROLES_ALLOWED_TO_CREATE_TASKS: UserRole[] = [
  UserRole.ADMIN,
  UserRole.PROGRAM_MANAGER,
  UserRole.QA,
  UserRole.EXECUTIVE,
];

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

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(id, req.user.tenantId);
    if (!this.tasksService.canView(task, currentUser)) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return this.tasksService.findOneWithComputed(id, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_CREATE_TASKS.includes(currentUser.role)) {
      throw new ForbiddenException('Only Admin, Program Manager, QA, and Executive can create tasks.');
    }
    return this.tasksService.create(dto, currentUser, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.tasksService.update(id, dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/status')
  async updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskStatusDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.tasksService.updateStatus(id, dto.status, currentUser, req.user.tenantId);
  }
}
