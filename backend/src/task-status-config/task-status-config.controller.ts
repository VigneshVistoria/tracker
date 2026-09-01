import { Controller, Get, Patch, Body, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { TaskStatusConfigService } from './task-status-config.service';
import { UpdateTaskStatusPercentDto } from './dto/update-task-status-percent.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

// Admin-only end to end, same as SlaController/PerformanceScoringController -
// this changes how progress is reported org-wide, not a single task's own data.
@Controller('task-status-config')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TaskStatusConfigController {
  constructor(private taskStatusConfigService: TaskStatusConfigService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.taskStatusConfigService.findAllForTenant(req.user.tenantId);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskStatusPercentDto, @Req() req: any) {
    return this.taskStatusConfigService.update(id, dto.percent, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }
}
