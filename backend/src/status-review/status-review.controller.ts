import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { StatusReviewService } from './status-review.service';

// Program Manager and Executive only (confirmed with the user 2026-10) -
// narrower than Team Tasks, which also allows Admin. Same inline
// look-up-the-role check TasksController uses (the JWT carries no role).
export const ROLES_ALLOWED_TO_VIEW_STATUS_REVIEW: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];

@Controller('status-review')
@UseGuards(JwtAuthGuard)
export class StatusReviewController {
  constructor(
    private readonly statusReviewService: StatusReviewService,
    private readonly usersService: UsersService,
  ) {}

  // Summary counts, per-assignee counts, totals and the record list, all
  // from one computeStatusReview() call.
  @Get()
  async getSummary(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!currentUser || !ROLES_ALLOWED_TO_VIEW_STATUS_REVIEW.includes(currentUser.role)) {
      throw new ForbiddenException('Only Program Manager or Executive can view Status Review.');
    }
    return this.statusReviewService.getSummary(req.user.tenantId);
  }
}
