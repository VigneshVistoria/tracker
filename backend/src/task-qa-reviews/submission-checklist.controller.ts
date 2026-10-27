import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { SubmissionChecklistService, SUBMISSION_CHECKLIST_SETTINGS_ROLES } from './submission-checklist.service';
import { SaveSubmissionChecklistSettingsDto, SetSubmissionChecklistSwitchDto } from './dto/submission-checklist-settings.dto';

// Developer submission checklist (defect triage Stage 2, 2026-10-27) - see
// tasks/submission-checklist.ts. Its own prefix, so nothing is read as a
// 'tasks/:id'.
@Controller('submission-checklist')
@UseGuards(JwtAuthGuard)
export class SubmissionChecklistController {
  constructor(
    private checklist: SubmissionChecklistService,
    private usersService: UsersService,
  ) {}

  private async editor(req: any) {
    const user = (await this.usersService.findById(req.user.sub))!;
    if (!SUBMISSION_CHECKLIST_SETTINGS_ROLES.includes(user.role)) throw new ForbiddenException('Only an Admin or Program Manager can do this.');
    return user;
  }

  // The submit form's lists and rules - any signed-in user.
  @Get('options')
  async options(@Req() req: any) {
    return this.checklist.options(req.user.tenantId);
  }

  @Get('settings')
  async settings(@Req() req: any) {
    await this.editor(req);
    return this.checklist.settingsPage(req.user.tenantId);
  }

  @Patch('settings')
  async saveSettings(@Body() dto: SaveSubmissionChecklistSettingsDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.checklist.saveSettings(dto, user, req.user.tenantId);
  }

  @Patch('projects/:id')
  async setSwitch(@Param('id', ParseIntPipe) id: number, @Body() dto: SetSubmissionChecklistSwitchDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.checklist.setProjectSwitch(id, dto.enabled, user, req.user.tenantId);
  }
}
