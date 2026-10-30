import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TaskActivityService } from './task-activity.service';
import { AddProgressNoteDto, ChaseTaskDto } from './dto/task-activity.dto';

// Performance Tracking B1 - Chase and progress notes, see ./task-activity.ts.
@Controller('tasks/:id/activity')
@UseGuards(JwtAuthGuard)
export class TaskActivityController {
  constructor(
    private activity: TaskActivityService,
    private usersService: UsersService,
  ) {}

  private me(req: any) {
    return this.usersService.findById(req.user.sub);
  }

  @Get()
  async state(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.activity.state(id, (await this.me(req))!, req.user.tenantId);
  }

  @Post('chase')
  async chase(@Param('id', ParseIntPipe) id: number, @Body() dto: ChaseTaskDto, @Req() req: any) {
    return this.activity.chase(id, dto, (await this.me(req))!, req.user.tenantId);
  }

  @Post('notes')
  async addNote(@Param('id', ParseIntPipe) id: number, @Body() dto: AddProgressNoteDto, @Req() req: any) {
    return this.activity.addNote(id, dto, (await this.me(req))!, req.user.tenantId);
  }
}
