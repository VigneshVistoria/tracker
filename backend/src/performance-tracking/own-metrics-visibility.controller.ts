import { Body, Controller, ForbiddenException, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { ArrayMaxSize, IsArray, IsIn } from 'class-validator';
import { OWN_METRICS_ROLE_CHOICES, OwnMetricsVisibilityService } from './own-metrics-visibility.service';

export class OwnMetricsVisibilityDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(OWN_METRICS_ROLE_CHOICES, { each: true })
  roles: UserRole[];
}

// "Show own performance metrics to team members" - Admin only, audited.
// GET /me tells the app whether to show the user's performance links.
@Controller('own-metrics-visibility')
@UseGuards(JwtAuthGuard)
export class OwnMetricsVisibilityController {
  constructor(
    private readonly visibility: OwnMetricsVisibilityService,
    private readonly usersService: UsersService,
  ) {}

  private async admin(req: any) {
    const user = await this.usersService.findById(req.user.sub);
    if (!user || user.tenantId !== req.user.tenantId || user.role !== UserRole.ADMIN) throw new ForbiddenException('Only an Admin can change who sees performance figures.');
    return user;
  }

  @Get('me')
  async me(@Req() req: any) {
    const user = await this.usersService.findById(req.user.sub);
    return { canSeeOwn: !!user && (await this.visibility.canSeeOwn(user, req.user.tenantId)) };
  }

  @Get()
  async get(@Req() req: any) {
    await this.admin(req);
    return { roles: await this.visibility.roles(req.user.tenantId), choices: OWN_METRICS_ROLE_CHOICES };
  }

  @Patch()
  async save(@Body() body: OwnMetricsVisibilityDto, @Req() req: any) {
    const user = await this.admin(req);
    return this.visibility.save(body.roles, user, req.user.tenantId);
  }
}
