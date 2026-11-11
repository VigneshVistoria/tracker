import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, Param, ParseIntPipe, Patch, Post, Query, RawBodyRequest, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PERFORMANCE_TRACKING_SETTINGS_ROLES } from '../performance-tracking/performance-tracking';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { GithubReleasesService } from './github-releases.service';
import { RepoMappingDto, UpdateGithubSettingsDto } from './dto/github-releases.dto';

// The GitHub App's webhook. No login - the X-Hub-Signature-256 check in the
// service is the only proof a delivery came from GitHub. Refused
// deliveries get a 401/503 (GitHub shows them as failed); everything else
// 2xx, with the outcome in the delivery log.
@Controller('integrations/github')
export class GithubWebhookController {
  constructor(private readonly github: GithubReleasesService) {}

  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>, @Res({ passthrough: true }) res: Response) {
    const result = await this.github.receive(req.rawBody, req.headers as Record<string, any>, req.body);
    if (result.status >= 400) throw new HttpException(result.message, result.status);
    res.status(result.status);
    return { outcome: result.outcome, message: result.message };
  }
}

// Settings, repository mappings and the delivery log - Admin and Program
// Manager, like the other Performance Tracking settings.
@Controller('github-releases')
@UseGuards(JwtAuthGuard)
export class GithubReleasesController {
  constructor(
    private readonly github: GithubReleasesService,
    private readonly usersService: UsersService,
  ) {}

  private async editor(req: any) {
    const user = await this.usersService.findById(req.user.sub);
    if (!user || user.tenantId !== req.user.tenantId || !PERFORMANCE_TRACKING_SETTINGS_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an Admin or Program Manager can do this.');
    }
    return user;
  }

  @Get('settings')
  async settings(@Req() req: any) {
    await this.editor(req);
    return this.github.settingsPage(req.user.tenantId);
  }

  @Patch('settings')
  async saveSettings(@Body() dto: UpdateGithubSettingsDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.github.saveSettings(dto, user, req.user.tenantId);
  }

  @Post('mappings')
  async createMapping(@Body() dto: RepoMappingDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.github.createMapping(dto, user, req.user.tenantId);
  }

  @Patch('mappings/:id')
  async updateMapping(@Param('id', ParseIntPipe) id: number, @Body() dto: RepoMappingDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.github.updateMapping(id, dto, user, req.user.tenantId);
  }

  // PR helpers for one project's task page - any internal user.
  @Get('pr-helper')
  async prHelper(@Query('projectId') projectId: string | undefined, @Req() req: any) {
    const user = await this.usersService.findById(req.user.sub);
    if (!user || user.tenantId !== req.user.tenantId || user.role === UserRole.CLIENT) throw new ForbiddenException('Not available.');
    const id = Number(projectId);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('projectId is required.');
    return this.github.prHelper(req.user.tenantId, id);
  }

  // Deliveries that matched no mapped repository are shown to Admins only.
  @Get('deliveries')
  async deliveries(@Query('limit') limit: string | undefined, @Req() req: any) {
    const user = await this.editor(req);
    return this.github.deliveries(req.user.tenantId, user.role === UserRole.ADMIN, Number(limit) || 100);
  }
}
