import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TasksService } from './tasks.service';
import { ReopenAfterPassService } from './reopen-after-pass.service';
import { ReopenAfterPassDto } from './dto/reopen-after-pass.dto';

// Performance Tracking S4 - Reopen after Pass, see ./qa-intake.ts.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class ReopenAfterPassController {
  constructor(
    private reopens: ReopenAfterPassService,
    private tasksService: TasksService,
    private usersService: UsersService,
  ) {}

  @Post(':id/reopen-after-pass')
  async reopen(@Param('id', ParseIntPipe) id: number, @Body() dto: ReopenAfterPassDto, @Req() req: any) {
    return this.reopens.reopen(id, dto, (await this.usersService.findById(req.user.sub))!, req.user.tenantId);
  }

  @Get(':id/reopens')
  async list(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.usersService.findById(req.user.sub);
    const task = await this.tasksService.findOne(id, req.user.tenantId);
    if (!(await this.tasksService.canView(task, user))) throw new ForbiddenException('You do not have access to this task.');
    return this.reopens.list(id, req.user.tenantId);
  }
}
