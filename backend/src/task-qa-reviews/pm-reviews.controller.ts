import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { PmReviewsService } from './pm-reviews.service';
import { PmSendBackDto, PmSendToQaDto, SetPmReminderSettingsDto, SetPmReviewSwitchDto } from './dto/pm-review.dto';

// PM review gate (2026-10-13). Deciding and the queue: Program Manager or
// Admin. The per-project switch: Admin only. Its own 'pm-review' prefix -
// a 'tasks/pm-review-queue' route would be swallowed by TasksController's
// 'tasks/:id'.
const PM_REVIEW_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];

@Controller('pm-review')
@UseGuards(JwtAuthGuard)
export class PmReviewsController {
  constructor(
    private pmReviewsService: PmReviewsService,
    private usersService: UsersService,
  ) {}

  private async actor(req: any, roles: UserRole[], what: string) {
    const user = await this.usersService.findById(req.user.sub);
    if (!roles.includes(user.role)) throw new ForbiddenException(`Only ${what} can do this.`);
    return user;
  }

  @Get('queue')
  async queue(@Req() req: any) {
    await this.actor(req, PM_REVIEW_ROLES, 'a Program Manager or Admin');
    return this.pmReviewsService.queue(req.user.tenantId);
  }

  @Patch('tasks/:id/send-to-qa')
  async sendToQa(@Param('id', ParseIntPipe) id: number, @Body() dto: PmSendToQaDto, @Req() req: any) {
    const user = await this.actor(req, PM_REVIEW_ROLES, 'a Program Manager or Admin');
    return this.pmReviewsService.sendToQa(id, dto, user, req.user.tenantId);
  }

  @Patch('tasks/:id/send-back')
  async sendBack(@Param('id', ParseIntPipe) id: number, @Body() dto: PmSendBackDto, @Req() req: any) {
    const user = await this.actor(req, PM_REVIEW_ROLES, 'a Program Manager or Admin');
    return this.pmReviewsService.sendBack(id, dto, user, req.user.tenantId);
  }

  @Get('settings')
  async settings(@Req() req: any) {
    await this.actor(req, [UserRole.ADMIN], 'an Admin');
    return this.pmReviewsService.settings(req.user.tenantId);
  }

  @Patch('projects/:id')
  async setSwitch(@Param('id', ParseIntPipe) id: number, @Body() dto: SetPmReviewSwitchDto, @Req() req: any) {
    const user = await this.actor(req, [UserRole.ADMIN], 'an Admin');
    return this.pmReviewsService.setSwitch(id, dto.enabled, user, req.user.tenantId);
  }

  @Patch('reminder-settings')
  async setReminderSettings(@Body() dto: SetPmReminderSettingsDto, @Req() req: any) {
    const user = await this.actor(req, [UserRole.ADMIN], 'an Admin');
    return this.pmReviewsService.setReminderSettings(dto.workingDays, dto.toAdmin, user, req.user.tenantId);
  }
}
