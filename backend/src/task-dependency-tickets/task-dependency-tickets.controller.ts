import { Controller, Get, Post, Body, Query, UseGuards, Req, ParseIntPipe, ForbiddenException } from '@nestjs/common';
import { TaskDependencyTicketsService } from './task-dependency-tickets.service';
import { CreateTaskDependencyTicketDto } from './dto/create-task-dependency-ticket.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TasksService } from '../tasks/tasks.service';

@Controller('task-dependency-tickets')
@UseGuards(JwtAuthGuard)
export class TaskDependencyTicketsController {
  constructor(
    private ticketsService: TaskDependencyTicketsService,
    private usersService: UsersService,
    private tasksService: TasksService,
  ) {}

  // Dependency Clearance inbox ("Outbound" on the Developer Dashboard).
  // Declared before the parentTaskId-filtered GET below purely for
  // readability - both are distinct routes ('mine' has no query param)
  // so ordering doesn't affect matching here.
  @Get('mine')
  async findMine(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.findMine(currentUser.id, req.user.tenantId);
  }

  // Developer Dashboard "Inbound" card - tickets I filed because I'm
  // blocked on someone else.
  @Get('created-by-me')
  async findCreatedByMe(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.findCreatedByMe(currentUser.id, req.user.tenantId);
  }

  // Combined task detail view - dependency tickets for a given parent task.
  // Same visibility rule as the parent task itself (Assignee/creator/
  // leadership/ticket owner) so this can't be used to read another user's
  // task's dependency chatter.
  @Get()
  async findForTask(@Query('parentTaskId', ParseIntPipe) parentTaskId: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(parentTaskId, req.user.tenantId);
    if (!(await this.tasksService.canView(task, currentUser))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return this.ticketsService.findForTask(parentTaskId, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateTaskDependencyTicketDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.ticketsService.create(dto, currentUser, req.user.tenantId);
  }
}
