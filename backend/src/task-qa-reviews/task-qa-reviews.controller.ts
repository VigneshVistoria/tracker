import { Controller, Get, Post, Patch, Body, Param, ParseIntPipe, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { TaskQaReviewsService } from './task-qa-reviews.service';
import { QaSubmitTaskDto } from './dto/qa-submit-task.dto';
import { QaApproveTaskDto } from './dto/qa-approve-task.dto';
import { QaRejectTaskDto } from './dto/qa-reject-task.dto';
import { QaEscalateTaskDto } from './dto/qa-escalate-task.dto';
import { QaRevertDecisionDto } from './dto/qa-revert-decision.dto';
import { QaSendBackDto } from './dto/qa-send-back.dto';
import { QaNotReadyTaskDto, SetQaNotReadyReasonsDto } from './dto/qa-not-ready.dto';
import { UserRole } from '../users/user.entity';
import { TasksService } from '../tasks/tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';

// Mounted at the same 'tasks' prefix as TasksController (a second
// controller sharing a prefix is fine in Nest - these routes are all
// two-segment (':id/qa-submit' etc.), so they never collide with
// TasksController's own ':id'/'backlog'/'mine' routes) - keeps the QA
// review endpoints under the Task resource URL shape the workflow spec
// asked for, while keeping the round-tracking logic in its own module.
// Who may undo a mistaken QA decision - the same Program Manager + Admin
// pair as Hold/Release/Close/Reopen (confirmed with the user 2026-10-13).
const ROLES_ALLOWED_TO_REVERT_QA_DECISION: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
// Who may pull a task back from QA to the developer (2026-10-16) - same
// pair; sending it to a different developer is Program Manager only
// (checked in the service).
const ROLES_ALLOWED_TO_SEND_BACK_FROM_QA: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
// QA "Not ready for testing" reasons (2026-10-27): QA reads them to pick
// one, Admin and Program Manager edit them.
const ROLES_ALLOWED_TO_READ_NOT_READY_REASONS: UserRole[] = [UserRole.QA, UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
const ROLES_ALLOWED_TO_EDIT_NOT_READY_REASONS: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];

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
  async approve(@Param('id', ParseIntPipe) id: number, @Body() dto: QaApproveTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.qaReviewsService.approve(id, dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/qa-reject')
  async reject(@Param('id', ParseIntPipe) id: number, @Body() dto: QaRejectTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.qaReviewsService.reject(id, dto, currentUser, req.user.tenantId);
  }

  // The other kind of Reject - QA could not start testing (2026-10-27).
  @Patch(':id/qa-not-ready')
  async markNotReady(@Param('id', ParseIntPipe) id: number, @Body() dto: QaNotReadyTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.qaReviewsService.markNotReady(id, dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/qa-escalate')
  async escalate(@Param('id', ParseIntPipe) id: number, @Body() dto: QaEscalateTaskDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.qaReviewsService.escalate(id, dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/qa-revert')
  async revertDecision(@Param('id', ParseIntPipe) id: number, @Body() dto: QaRevertDecisionDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_REVERT_QA_DECISION.includes(currentUser.role)) {
      throw new ForbiddenException('Only a Program Manager or Admin can revert a QA decision.');
    }
    return this.qaReviewsService.revertDecision(id, dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/qa-send-back')
  async sendBackFromQa(@Param('id', ParseIntPipe) id: number, @Body() dto: QaSendBackDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_SEND_BACK_FROM_QA.includes(currentUser.role)) {
      throw new ForbiddenException('Only a Program Manager or Admin can send a task back from QA to the developer.');
    }
    return this.qaReviewsService.sendBackFromQa(id, dto, currentUser, req.user.tenantId);
  }
}

// Its own 'qa-review' prefix - a 'tasks/qa-not-ready-reasons' route would
// be swallowed by TasksController's 'tasks/:id'.
@Controller('qa-review')
@UseGuards(JwtAuthGuard)
export class QaReviewSettingsController {
  constructor(
    private qaReviewsService: TaskQaReviewsService,
    private usersService: UsersService,
  ) {}

  @Get('not-ready-reasons')
  async notReadyReasons(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_READ_NOT_READY_REASONS.includes(currentUser.role)) {
      throw new ForbiddenException('Only QA, a Program Manager or Admin can see the not-ready reasons.');
    }
    return { reasons: await this.qaReviewsService.notReadyReasons(req.user.tenantId) };
  }

  @Patch('not-ready-reasons')
  async setNotReadyReasons(@Body() dto: SetQaNotReadyReasonsDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_EDIT_NOT_READY_REASONS.includes(currentUser.role)) {
      throw new ForbiddenException('Only a Program Manager or Admin can edit the not-ready reasons.');
    }
    return { reasons: await this.qaReviewsService.setNotReadyReasons(dto.reasons, currentUser, req.user.tenantId) };
  }
}
