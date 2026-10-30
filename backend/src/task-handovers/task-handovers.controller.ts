import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TaskHandoversService } from './task-handovers.service';
import { RejectHandoverDto, StartHandoverDto } from './dto/task-handovers.dto';

// Performance Tracking C4 - see ./task-handovers.ts.
@Controller()
@UseGuards(JwtAuthGuard)
export class TaskHandoversController {
  constructor(
    private handovers: TaskHandoversService,
    private usersService: UsersService,
  ) {}

  private async me(req: any) {
    return (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
  }

  @Get('tasks/:id/handovers')
  async state(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.handovers.state(id, await this.me(req), req.user.tenantId);
  }

  @Post('tasks/:id/handovers')
  async start(@Param('id', ParseIntPipe) id: number, @Body() dto: StartHandoverDto, @Req() req: any) {
    return this.handovers.start(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('task-handovers/:id/accept')
  async accept(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.handovers.accept(id, await this.me(req), req.user.tenantId);
  }

  @Post('task-handovers/:id/reject')
  async reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectHandoverDto, @Req() req: any) {
    return this.handovers.reject(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('task-handovers/:id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.handovers.cancel(id, await this.me(req), req.user.tenantId);
  }
}
