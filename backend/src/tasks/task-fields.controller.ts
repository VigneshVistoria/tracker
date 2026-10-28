import { Body, Controller, Get, Param, ParseIntPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TaskFieldsService } from './task-fields.service';
import { ImprovementDecisionDto, UpdateTaskFieldsDto } from './dto/task-fields.dto';

// Performance Tracking S4b - see ./task-fields.ts.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TaskFieldsController {
  constructor(
    private fields: TaskFieldsService,
    private usersService: UsersService,
  ) {}

  private me(req: any) {
    return this.usersService.findById(req.user.sub);
  }

  @Get(':id/tracking-fields')
  async state(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.fields.state(id, (await this.me(req))!, req.user.tenantId);
  }

  @Patch(':id/tracking-fields')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskFieldsDto, @Req() req: any) {
    return this.fields.update(id, dto, (await this.me(req))!, req.user.tenantId);
  }

  @Patch(':id/improvement-decision')
  async decide(@Param('id', ParseIntPipe) id: number, @Body() dto: ImprovementDecisionDto, @Req() req: any) {
    return this.fields.decide(id, dto, (await this.me(req))!, req.user.tenantId);
  }
}
