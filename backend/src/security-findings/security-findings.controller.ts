import { OWN_METRICS_REFUSAL, OwnMetricsVisibilityService } from '../performance-tracking/own-metrics-visibility.service';
import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { SecurityFindingsService } from './security-findings.service';
import { AcceptSecurityRiskDto, CreateSecurityFindingDto, SubmitSecurityFixDto, UpdateSecurityFindingDto, VerifySecurityFixDto } from './dto/security-findings.dto';

// Performance Tracking P3/P4 - see ./security-findings.ts.
@Controller('security-findings')
@UseGuards(JwtAuthGuard)
export class SecurityFindingsController {
  constructor(
    private findings: SecurityFindingsService,
    private usersService: UsersService,
    private ownMetrics: OwnMetricsVisibilityService,
  ) {}

  // 2026-11-11 (the user): hidden from Developer/Designer/DevOps/QA - page
  // and every action - unless an Admin allows their role ("Show own
  // performance metrics to team members"). Admin/PM/Executive unchanged.
  private async me(req: any) {
    const user = (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
    if (!user || !(await this.ownMetrics.canSeeOwn(user, req.user.tenantId))) throw new ForbiddenException(OWN_METRICS_REFUSAL);
    return user;
  }

  @Get()
  async list(@Req() req: any) {
    return this.findings.list(await this.me(req), req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateSecurityFindingDto, @Req() req: any) {
    return this.findings.create(dto, await this.me(req), req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSecurityFindingDto, @Req() req: any) {
    return this.findings.update(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post(':id/fix')
  async submitFix(@Param('id', ParseIntPipe) id: number, @Body() dto: SubmitSecurityFixDto, @Req() req: any) {
    return this.findings.submitFix(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post(':id/verify')
  async verify(@Param('id', ParseIntPipe) id: number, @Body() dto: VerifySecurityFixDto, @Req() req: any) {
    return this.findings.verify(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post(':id/accept-risk')
  async acceptRisk(@Param('id', ParseIntPipe) id: number, @Body() dto: AcceptSecurityRiskDto, @Req() req: any) {
    return this.findings.acceptRisk(id, dto, await this.me(req), req.user.tenantId);
  }
}
