import { Controller, Get, Post, Patch, Body, Param, ParseIntPipe, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { TaskQaReviewsService } from './task-qa-reviews.service';
import { QaSubmitTaskDto } from './dto/qa-submit-task.dto';
import { QaRejectTaskDto } from './dto/qa-reject-task.dto';
import { TasksService } from '../tasks/tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';

// Mounted at the same 'tasks' prefix as TasksController (a second
// controller sharing a prefix is fine in Nest - these routes are all
// two-segment (':id/qa-submit' etc.), so they never collide with
// TasksController's own ':id'/'backlog'/'mine' routes) - keeps the QA
// review endpoints under the Task resource URL shape the workflow spec
// asked for, while keeping the round-tracking logic in its own module.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TaskQaReviewsController {
  constructor(
    private qaReviewsService: TaskQaReviewsService,
    private tasksService: TasksService,
    private usersService: UsersService,
  ) {}

  @Get(':id/qa-reviews')
  async findForTask(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(id, req.user.tenantId);
    if (!(await this.tasksService.canView(task, currentUser))) {
      throw new ForbiddenException('You do not have access to this task.');
    }
    return this.qaReviewsService.findForTask(id, req.user.tenantId);
  }

  @Post(':id/qa-submit')
  async submit(@Param('id', ParseIntPipe) id: number, @Body() dto: QaSubmitTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.qaReviewsService.submit(id, dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/qa-approve')
  async approve(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.qaReviewsService.approve(id, currentUser, req.user.tenantId);
  }

  @Patch(':id/qa-reject')
  async reject(@Param('id', ParseIntPipe) id: number, @Body() dto: QaRejectTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.qaReviewsService.reject(id, dto, currentUser, req.user.tenantId);
  }
}
