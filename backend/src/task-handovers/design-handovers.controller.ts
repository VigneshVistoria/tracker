import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { DesignHandoversService } from './design-handovers.service';
import { AcceptDesignHandoverDto, RejectHandoverDto, StartDesignHandoverDto } from './dto/task-handovers.dto';

// "Hand over to development" - see ./design-handovers.ts.
@Controller()
@UseGuards(JwtAuthGuard)
export class DesignHandoversController {
  constructor(
    private designHandovers: DesignHandoversService,
    private usersService: UsersService,
  ) {}

  private async me(req: any) {
    return (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
  }

  @Get('tasks/:id/design-handover')
  async state(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.designHandovers.state(id, await this.me(req), req.user.tenantId);
  }

  @Post('tasks/:id/design-handover')
  async start(@Param('id', ParseIntPipe) id: number, @Body() dto: StartDesignHandoverDto, @Req() req: any) {
    return this.designHandovers.start(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('design-handovers/:id/accept')
  async accept(@Param('id', ParseIntPipe) id: number, @Body() dto: AcceptDesignHandoverDto, @Req() req: any) {
    return this.designHandovers.accept(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('design-handovers/:id/reject')
  async reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectHandoverDto, @Req() req: any) {
    return this.designHandovers.reject(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('design-handovers/:id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.designHandovers.cancel(id, await this.me(req), req.user.tenantId);
  }
}
