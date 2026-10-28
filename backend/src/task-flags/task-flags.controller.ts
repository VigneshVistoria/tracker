import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TaskFlagsService } from './task-flags.service';
import { ClearTaskFlagDto, SetTaskFlagDto } from './dto/task-flags.dto';

const MAX_OPEN_IDS = 500;

// Performance Tracking S3 - risk and blocker flags, see ./task-flags.ts.
@Controller('task-flags')
@UseGuards(JwtAuthGuard)
export class TaskFlagsController {
  constructor(
    private flags: TaskFlagsService,
    private usersService: UsersService,
  ) {}

  private me(req: any) {
    return this.usersService.findById(req.user.sub);
  }

  // Team Tasks badges: ?taskIds=1,2,3
  @Get('open')
  async open(@Query('taskIds') taskIds: string | undefined, @Req() req: any) {
    const ids = [...new Set((taskIds || '').split(',').filter(Boolean).map(Number))];
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new BadRequestException('taskIds must be a comma-separated list of ids.');
    if (ids.length > MAX_OPEN_IDS) throw new BadRequestException(`At most ${MAX_OPEN_IDS} tasks at a time.`);
    return this.flags.open(ids, (await this.me(req))!, req.user.tenantId);
  }

  @Get()
  async state(@Query('taskId', ParseIntPipe) taskId: number, @Req() req: any) {
    return this.flags.state(taskId, (await this.me(req))!, req.user.tenantId);
  }

  @Post()
  async set(@Body() dto: SetTaskFlagDto, @Req() req: any) {
    return this.flags.set(dto, (await this.me(req))!, req.user.tenantId);
  }

  @Patch(':id/clear')
  async clear(@Param('id', ParseIntPipe) id: number, @Body() dto: ClearTaskFlagDto, @Req() req: any) {
    return this.flags.clear(id, dto, (await this.me(req))!, req.user.tenantId);
  }
}
