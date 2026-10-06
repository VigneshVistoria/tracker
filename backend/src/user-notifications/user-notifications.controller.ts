import { Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserNotificationsService } from './user-notifications.service';

// Every route is scoped to the caller's own notifications (req.user.sub) -
// there is deliberately no way to read or modify anyone else's.
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class UserNotificationsController {
  constructor(private notificationsService: UserNotificationsService) {}

  @Get()
  findMine(@Query('limit') limit: string | undefined, @Req() req: any) {
    return this.notificationsService.findForUser(req.user.sub, req.user.tenantId, limit ? Number(limit) || 30 : 30);
  }

  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    return { count: await this.notificationsService.countUnread(req.user.sub, req.user.tenantId) };
  }

  @Post('read-all')
  markAllRead(@Req() req: any) {
    return this.notificationsService.markAllRead(req.user.sub, req.user.tenantId);
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.notificationsService.markRead(id, req.user.sub, req.user.tenantId);
  }
}
