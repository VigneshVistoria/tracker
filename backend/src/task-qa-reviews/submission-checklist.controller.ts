import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { SubmissionChecklistService, SUBMISSION_CHECKLIST_SETTINGS_ROLES } from './submission-checklist.service';
import { SaveSubmissionChecklistSettingsDto, SetSubmissionChecklistSwitchDto } from './dto/submission-checklist-settings.dto';
import { ArtifactTypesService } from '../artifact-types/artifact-types.service';
import { CreateArtifactTypeDto, ReorderArtifactTypesDto, SetArtifactRulesDto, UpdateArtifactTypeDto } from '../artifact-types/dto/artifact-types.dto';

// Developer submission checklist (defect triage Stage 2, 2026-10-27) - see
// tasks/submission-checklist.ts. Its own prefix, so nothing is read as a
// 'tasks/:id'.
@Controller('submission-checklist')
@UseGuards(JwtAuthGuard)
export class SubmissionChecklistController {
  constructor(
    private checklist: SubmissionChecklistService,
    private usersService: UsersService,
    private artifactTypes: ArtifactTypesService,
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

  // Artifact types section (2026-11-06): the configurable submission
  // artifact types and the per-role rules - see ArtifactTypesService.
  @Get('artifact-types')
  async artifactTypeSettings(@Req() req: any) {
    await this.editor(req);
    return this.artifactTypes.settingsPage(req.user.tenantId);
  }

  @Post('artifact-types')
  async createArtifactType(@Body() dto: CreateArtifactTypeDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.artifactTypes.create(dto.label, user, req.user.tenantId);
  }

  // Reorder before ':id' so 'order' is never read as an id.
  @Put('artifact-types/order')
  async reorderArtifactTypes(@Body() dto: ReorderArtifactTypesDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.artifactTypes.reorder(dto.ids, user, req.user.tenantId);
  }

  // A type the checklist counts as the change link or as self-test
  // evidence can't be deactivated until it's unticked there - otherwise
  // the checklist could ask for a type nobody can pick.
  @Patch('artifact-types/:id')
  async updateArtifactType(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateArtifactTypeDto, @Req() req: any) {
    const user = await this.editor(req);
    if (dto.active === false) {
      const type = (await this.artifactTypes.types(req.user.tenantId)).find((t) => t.id === id);
      const settings = await this.checklist.settings(req.user.tenantId);
      if (type && (settings.linkArtifactTypes.includes(type.code) || settings.evidenceArtifactTypes.includes(type.code))) {
        throw new BadRequestException(`"${type.label}" counts for the submission checklist - untick it under "Count as" first, then deactivate it.`);
      }
    }
    return this.artifactTypes.update(id, { label: dto.label, active: dto.active }, user, req.user.tenantId);
  }

  @Put('artifact-rules/:role')
  async setArtifactRules(@Param('role') role: string, @Body() dto: SetArtifactRulesDto, @Req() req: any) {
    const user = await this.editor(req);
    return this.artifactTypes.setRoleRules(role, dto.rules, user, req.user.tenantId);
  }
}
