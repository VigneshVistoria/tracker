import { BadRequestException, Body, Controller, ForbiddenException, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { MeetingAttendanceService } from './meeting-attendance.service';
import { MeetingImportService } from './meeting-import.service';
import { MEETING_PAGE_ROLES, MEETING_SETTINGS_EDIT_ROLES } from './meeting-attendance';
import { UpdateMeetingAttendanceSettingsDto } from './dto/meeting-attendance.dto';

// C6 meeting attendance (2026-11-11). Admin and Program Manager see the
// page; only an Admin changes the settings (audited).
@Controller('meeting-attendance')
@UseGuards(JwtAuthGuard)
export class MeetingAttendanceController {
  constructor(
    private readonly meetings: MeetingAttendanceService,
    private readonly imports: MeetingImportService,
    private readonly usersService: UsersService,
  ) {}

  private async member(req: any, roles: UserRole[], refusal: string) {
    const user = await this.usersService.findById(req.user.sub);
    if (!user || user.tenantId !== req.user.tenantId || !roles.includes(user.role)) throw new ForbiddenException(refusal);
    return user;
  }

  @Get('settings')
  async settings(@Req() req: any) {
    await this.member(req, MEETING_PAGE_ROLES, 'Only an Admin or Program Manager can see meeting attendance settings.');
    const [page, imports] = await Promise.all([this.meetings.page(req.user.tenantId), this.imports.recent(req.user.tenantId)]);
    return { ...page, imports };
  }

  // Series picker - reads the organiser's calendar from Teams (read-only).
  @Get('series')
  async series(@Query('organiserUserId') organiserUserId: string, @Req() req: any) {
    await this.member(req, MEETING_SETTINGS_EDIT_ROLES, 'Only an Admin can pick the tracked meetings.');
    const id = Number(organiserUserId);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('organiserUserId is required.');
    return this.imports.listSeries(req.user.tenantId, id);
  }

  // "Import now" - same as the nightly 01:30 EAT import.
  @Post('import')
  async importNow(@Req() req: any) {
    const user = await this.member(req, MEETING_PAGE_ROLES, 'Only an Admin or Program Manager can run the import.');
    return this.imports.importNow(req.user.tenantId, user);
  }

  @Patch('settings')
  async save(@Body() dto: UpdateMeetingAttendanceSettingsDto, @Req() req: any) {
    const user = await this.member(req, MEETING_SETTINGS_EDIT_ROLES, 'Only an Admin can change the meeting attendance settings.');
    return this.meetings.saveSettings(dto, user, req.user.tenantId);
  }
}
