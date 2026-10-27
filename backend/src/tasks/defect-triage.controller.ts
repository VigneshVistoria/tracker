import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { DefectTriageService, DEFECT_DISPUTE_DECIDE_ROLES, DEFECT_TRIAGE_SETTINGS_ROLES } from './defect-triage.service';
import {
  DecideDisputeDto,
  DisputeDefectDto,
  SaveDefectTriageSettingsDto,
  SetDefectTriageSwitchDto,
  UpdateDefectClassificationDto,
} from './dto/defect-triage.dto';

// Defect classification + triage (2026-10-27) - see ./defect-triage.ts. Its
// own 'defect-triage' prefix, so nothing here is read as a 'tasks/:id'.
@Controller('defect-triage')
@UseGuards(JwtAuthGuard)
export class DefectTriageController {
  constructor(
    private triage: DefectTriageService,
    private usersService: UsersService,
  ) {}

  private async me(req: any, roles?: UserRole[], what?: string) {
    const user = (await this.usersService.findById(req.user.sub))!;
    if (roles && !roles.includes(user.role)) throw new ForbiddenException(`Only ${what} can do this.`);
    return user;
  }

  // Lists for Create Defect / the reject form - any signed-in user.
  @Get('options')
  async options(@Req() req: any) {
    await this.me(req);
    return this.triage.options(req.user.tenantId);
  }

  @Get('settings')
  async settings(@Req() req: any) {
    await this.me(req, DEFECT_TRIAGE_SETTINGS_ROLES, 'an Admin or Program Manager');
    return this.triage.settingsPage(req.user.tenantId);
  }

  @Patch('settings')
  async saveSettings(@Body() dto: SaveDefectTriageSettingsDto, @Req() req: any) {
    const user = await this.me(req, DEFECT_TRIAGE_SETTINGS_ROLES, 'an Admin or Program Manager');
    return this.triage.saveSettings(dto, user, req.user.tenantId);
  }

  @Patch('projects/:id')
  async setSwitch(@Param('id', ParseIntPipe) id: number, @Body() dto: SetDefectTriageSwitchDto, @Req() req: any) {
    const user = await this.me(req, DEFECT_TRIAGE_SETTINGS_ROLES, 'an Admin or Program Manager');
    return this.triage.setProjectSwitch(id, dto.enabled, user, req.user.tenantId);
  }

  // PM: disputed defects waiting for a decision.
  @Get('queue')
  async queue(@Req() req: any) {
    await this.me(req, DEFECT_DISPUTE_DECIDE_ROLES, 'a Program Manager or Admin');
    return this.triage.queue(req.user.tenantId);
  }

  // Developer: my defects waiting for Accept/Dispute.
  @Get('mine')
  async mine(@Req() req: any) {
    return this.triage.mine(await this.me(req), req.user.tenantId);
  }

  @Get('tasks/:id')
  async state(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.triage.state(id, await this.me(req), req.user.tenantId);
  }

  @Patch('tasks/:id/accept')
  async accept(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.triage.accept(id, await this.me(req), req.user.tenantId);
  }

  @Patch('tasks/:id/dispute')
  async dispute(@Param('id', ParseIntPipe) id: number, @Body() dto: DisputeDefectDto, @Req() req: any) {
    return this.triage.dispute(id, dto, await this.me(req), req.user.tenantId);
  }

  @Patch('tasks/:id/decide')
  async decide(@Param('id', ParseIntPipe) id: number, @Body() dto: DecideDisputeDto, @Req() req: any) {
    const user = await this.me(req, DEFECT_DISPUTE_DECIDE_ROLES, 'a Program Manager or Admin');
    return this.triage.decide(id, dto, user, req.user.tenantId);
  }

  @Patch('tasks/:id/classification')
  async classification(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDefectClassificationDto, @Req() req: any) {
    return this.triage.updateClassification(id, dto, await this.me(req), req.user.tenantId);
  }
}
