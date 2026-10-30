import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TaskRequestsService } from './task-requests.service';
import { AnswerTaskRequestDto, CreateTaskRequestDto } from './dto/task-requests.dto';

// B4 - requests on a task (C1), see ./task-requests.ts.
@Controller()
@UseGuards(JwtAuthGuard)
export class TaskRequestsController {
  constructor(
    private requests: TaskRequestsService,
    private usersService: UsersService,
  ) {}

  private me(req: any) {
    return this.usersService.findById(req.user.sub).then((u) => u!);
  }

  @Get('tasks/:id/requests')
  async state(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.requests.state(id, await this.me(req), req.user.tenantId);
  }

  @Post('tasks/:id/requests')
  async create(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateTaskRequestDto, @Req() req: any) {
    return this.requests.create(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('task-requests/:id/answer')
  async answer(@Param('id', ParseIntPipe) id: number, @Body() dto: AnswerTaskRequestDto, @Req() req: any) {
    return this.requests.answer(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('task-requests/dependency/:ticketId/answer')
  async answerDependency(@Param('ticketId', ParseIntPipe) ticketId: number, @Body() dto: AnswerTaskRequestDto, @Req() req: any) {
    return this.requests.answerDependency(ticketId, dto, await this.me(req), req.user.tenantId);
  }
}
