import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { DueDateChangeService } from './due-date-change.service';
import { CommitDueDateDto, DueDateChangeDto, DueDateDecisionDto, ProposeDueDateDto } from './dto/due-date-change.dto';

// Performance Tracking S2 - committed Due date and change requests, see
// ./due-date-change.ts. Registered before TasksController in TasksModule so
// 'due-date-changes' is never read as a task ':id'.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class DueDateChangeController {
  constructor(
    private dueDates: DueDateChangeService,
    private usersService: UsersService,
  ) {}

  private me(req: any) {
    return this.usersService.findById(req.user.sub);
  }

  // PM/Admin: pending requests.
  @Get('due-date-changes')
  async queue(@Req() req: any) {
    return this.dueDates.queue((await this.me(req))!, req.user.tenantId);
  }

  @Patch('due-date-changes/:requestId/approve')
  async approve(@Param('requestId', ParseIntPipe) requestId: number, @Body() dto: DueDateDecisionDto, @Req() req: any) {
    return this.dueDates.approve(requestId, dto, (await this.me(req))!, req.user.tenantId);
  }

  @Patch('due-date-changes/:requestId/reject')
  async reject(@Param('requestId', ParseIntPipe) requestId: number, @Body() dto: DueDateDecisionDto, @Req() req: any) {
    return this.dueDates.reject(requestId, dto, (await this.me(req))!, req.user.tenantId);
  }

  @Patch('due-date-changes/:requestId/withdraw')
  async withdraw(@Param('requestId', ParseIntPipe) requestId: number, @Req() req: any) {
    return this.dueDates.withdraw(requestId, (await this.me(req))!, req.user.tenantId);
  }

  @Get(':id/due-date')
  async state(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.dueDates.state(id, (await this.me(req))!, req.user.tenantId);
  }

  // PM/Admin: propose the first Due date (tracking ON).
  @Post(':id/due-date/propose')
  async propose(@Param('id', ParseIntPipe) id: number, @Body() dto: ProposeDueDateDto, @Req() req: any) {
    return this.dueDates.propose(id, dto, (await this.me(req))!, req.user.tenantId);
  }

  // Assignee: the one free set or confirmation.
  @Post(':id/due-date/commit')
  async commit(@Param('id', ParseIntPipe) id: number, @Body() dto: CommitDueDateDto, @Req() req: any) {
    return this.dueDates.commit(id, dto, (await this.me(req))!, req.user.tenantId);
  }

  // Assignee: request a change. PM/Admin: change it directly.
  @Post(':id/due-date-changes')
  async change(@Param('id', ParseIntPipe) id: number, @Body() dto: DueDateChangeDto, @Req() req: any) {
    return this.dueDates.change(id, dto, (await this.me(req))!, req.user.tenantId);
  }
}
