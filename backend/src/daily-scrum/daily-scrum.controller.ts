import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { DailyScrumService, SCRUM_PEOPLE_ROLES } from './daily-scrum.service';
import { UpdateTeamSettingsDto } from './dto/update-team-settings.dto';

// Role rules confirmed with the user 2026-10-12. Same inline
// look-up-the-role check as StatusReviewController (the JWT carries no
// role). JwtAuthGuard answers 401 with no/invalid token; every wrong role -
// Client included - gets 403.
// Developer/Designer/DevOps/QA see only their own summary.
export const ROLES_ALLOWED_TO_VIEW_OWN_SCRUM: UserRole[] = SCRUM_PEOPLE_ROLES;
// Team and Individual tabs.
export const ROLES_ALLOWED_TO_VIEW_TEAM_SCRUM: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE, UserRole.ADMIN];
export const ROLES_ALLOWED_TO_VIEW_SCRUM_SETTINGS: UserRole[] = [...ROLES_ALLOWED_TO_VIEW_OWN_SCRUM, ...ROLES_ALLOWED_TO_VIEW_TEAM_SCRUM];
export const ROLES_ALLOWED_TO_EDIT_SCRUM_SETTINGS: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

@Controller('daily-scrum')
@UseGuards(JwtAuthGuard)
export class DailyScrumController {
  constructor(
    private readonly dailyScrumService: DailyScrumService,
    private readonly usersService: UsersService,
  ) {}

  private async requireRole(req: any, roles: UserRole[], message: string): Promise<User> {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!currentUser || currentUser.tenantId !== req.user.tenantId || !roles.includes(currentUser.role)) {
      throw new ForbiddenException(message);
    }
    return currentUser;
  }

  @Get('me')
  async getMine(@Req() req: any) {
    const user = await this.requireRole(req, ROLES_ALLOWED_TO_VIEW_OWN_SCRUM, 'Only Developers, Designers, DevOps and QA have a personal Daily Scrum.');
    return this.dailyScrumService.getMine(user, req.user.tenantId);
  }

  @Get('team')
  async getTeam(@Req() req: any) {
    await this.requireRole(req, ROLES_ALLOWED_TO_VIEW_TEAM_SCRUM, 'Only Program Manager, Executive or Admin can view the team Daily Scrum.');
    return this.dailyScrumService.getTeam(req.user.tenantId);
  }

  @Get('people/:userId')
  async getPerson(@Param('userId', ParseIntPipe) userId: number, @Req() req: any) {
    await this.requireRole(req, ROLES_ALLOWED_TO_VIEW_TEAM_SCRUM, 'Only Program Manager, Executive or Admin can view another person\'s Daily Scrum.');
    return this.dailyScrumService.getPerson(userId, req.user.tenantId);
  }

  @Get('settings')
  async getSettings(@Req() req: any) {
    await this.requireRole(req, ROLES_ALLOWED_TO_VIEW_SCRUM_SETTINGS, 'Not available for your role.');
    return this.dailyScrumService.getSettings(req.user.tenantId);
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateTeamSettingsDto, @Req() req: any) {
    const user = await this.requireRole(req, ROLES_ALLOWED_TO_EDIT_SCRUM_SETTINGS, 'Only Admin or Program Manager can change Daily Scrum settings.');
    return this.dailyScrumService.updateSettings(dto, user, req.user.tenantId);
  }
}
