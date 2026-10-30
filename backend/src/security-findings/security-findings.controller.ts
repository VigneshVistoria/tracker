import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
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
  ) {}

  private async me(req: any) {
    return (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
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
