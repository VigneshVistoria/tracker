import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { DailyScrumService, SCRUM_PEOPLE_ROLES } from './daily-scrum.service';
import { UpdateTeamSettingsDto } from './dto/update-team-settings.dto';
import { CreateExternalWaitDto, UpdateExternalWaitDto } from './dto/external-wait.dto';
import { ExternalWaitsService } from './external-waits.service';

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
// "Waiting on the city office" (Stage 3, 2026-10-16): seen on the Team tab
// by the same roles; kept (add/edit/resolve) by the same two roles that
// edit the settings.
export const ROLES_ALLOWED_TO_VIEW_EXTERNAL_WAITS: UserRole[] = ROLES_ALLOWED_TO_VIEW_TEAM_SCRUM;
export const ROLES_ALLOWED_TO_EDIT_EXTERNAL_WAITS: UserRole[] = ROLES_ALLOWED_TO_EDIT_SCRUM_SETTINGS;

// The external-wait endpoints take a body, so their role check is a guard:
// guards run before the ValidationPipe, so a wrong role gets 403 even with
// an invalid body (an in-handler check would answer 400 first). The user
// lands on req.scrumUser.
const SCRUM_ROLES = 'dailyScrumRoles';
const ScrumRoles = (roles: UserRole[], message: string) => SetMetadata(SCRUM_ROLES, { roles, message });

@Injectable()
class DailyScrumRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { roles, message } = this.reflector.get<{ roles: UserRole[]; message: string }>(SCRUM_ROLES, context.getHandler());
    const req = context.switchToHttp().getRequest();
    const user = await this.usersService.findById(req.user.sub);
    if (!user || user.tenantId !== req.user.tenantId || !roles.includes(user.role)) throw new ForbiddenException(message);
    req.scrumUser = user;
    return true;
  }
}

@Controller('daily-scrum')
@UseGuards(JwtAuthGuard)
export class DailyScrumController {
  constructor(
    private readonly dailyScrumService: DailyScrumService,
    private readonly usersService: UsersService,
    private readonly externalWaitsService: ExternalWaitsService,
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

  @Get('external-waits')
  @UseGuards(DailyScrumRolesGuard)
  @ScrumRoles(ROLES_ALLOWED_TO_VIEW_EXTERNAL_WAITS, 'Only Program Manager, Executive or Admin can view external waits.')
  async listExternalWaits(@Query('status') status: string | undefined, @Req() req: any) {
    const which = status ?? 'open';
    if (!['open', 'resolved', 'all'].includes(which)) throw new BadRequestException('status must be open, resolved or all.');
    return this.externalWaitsService.list(req.user.tenantId, which as 'open' | 'resolved' | 'all');
  }

  @Post('external-waits')
  @UseGuards(DailyScrumRolesGuard)
  @ScrumRoles(ROLES_ALLOWED_TO_EDIT_EXTERNAL_WAITS, 'Only Admin or Program Manager can add external waits.')
  async createExternalWait(@Body() dto: CreateExternalWaitDto, @Req() req: any) {
    return this.externalWaitsService.create(dto, req.scrumUser, req.user.tenantId);
  }

  @Patch('external-waits/:id')
  @UseGuards(DailyScrumRolesGuard)
  @ScrumRoles(ROLES_ALLOWED_TO_EDIT_EXTERNAL_WAITS, 'Only Admin or Program Manager can change external waits.')
  async updateExternalWait(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateExternalWaitDto, @Req() req: any) {
    return this.externalWaitsService.update(id, dto, req.scrumUser, req.user.tenantId);
  }
}
