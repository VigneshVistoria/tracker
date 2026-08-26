import { Controller, Get, Query, UseGuards, Req, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PerformanceDashboardService, PeriodType } from './performance-dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

const VALID_PERIODS: PeriodType[] = ['day', 'week', 'month'];

// Visibility mirrors IssuesController.findAll()'s existing pattern:
// Admin/Program Manager/Executive get the full team-wide view (and may
// optionally narrow it to one assignee via ?assigneeEmail=, a display
// filter only - it doesn't change what's computed, just what's shown).
// Developer/QA are hard-restricted server-side to their own row, with
// leaderboard/top-bottom performers omitted from the response entirely -
// never just hidden client-side. Client has no assigned internal work,
// so this dashboard isn't relevant to them and is blocked outright.
@Controller('performance-dashboard')
@UseGuards(JwtAuthGuard)
export class PerformanceDashboardController {
  constructor(
    private performanceDashboardService: PerformanceDashboardService,
    private usersService: UsersService,
  ) {}

  @Get()
  async getDashboard(
    @Query('period') period: string | undefined,
    @Query('date') date: string | undefined,
    @Query('projectId') projectId: string | undefined,
    @Query('assigneeEmail') assigneeEmail: string | undefined,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.CLIENT) {
      throw new ForbiddenException('The performance dashboard is an internal tool.');
    }

    const resolvedPeriod = (period as PeriodType) || 'week';
    if (!VALID_PERIODS.includes(resolvedPeriod)) {
      throw new BadRequestException(`period must be one of: ${VALID_PERIODS.join(', ')}`);
    }
    const referenceDate = date ? new Date(date) : new Date();
    if (Number.isNaN(referenceDate.getTime())) {
      throw new BadRequestException('date must be a valid ISO date string');
    }

    const isWideView =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.PROGRAM_MANAGER ||
      currentUser.role === UserRole.EXECUTIVE;

    const result = await this.performanceDashboardService.getDashboard({
      period: resolvedPeriod,
      referenceDate,
      projectId: projectId ? Number(projectId) : undefined,
      // Developer/QA: hard server-side restriction, ignores whatever
      // assigneeEmail the client might have sent.
      onlyAssigneeEmail: isWideView ? undefined : currentUser.email,
    });

    // Admin/PM/Executive's optional single-assignee filter - narrows the
    // displayed rows only; topPerformers/bottomPerformers/trend/analysis
    // stay team-wide so a filtered drill-down doesn't lose that context.
    if (isWideView && assigneeEmail) {
      result.rows = result.rows.filter((r) => r.assigneeEmail === assigneeEmail);
    }

    return result;
  }
}
