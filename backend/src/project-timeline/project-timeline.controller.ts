import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { ProjectTimelineService } from './project-timeline.service';
import {
  ApplyTimelineImportDto,
  CreateTimelineDependencyDto,
  CreateTimelineTeamDto,
  ExportTimelineDto,
  ParseTimelineFileDto,
  PreviewTimelineImportDto,
  ResetTimelineBaselineDto,
  SaveTimelineChangesDto,
  UpdateTimelineDependencyDto,
} from './dto/project-timeline.dto';

// Project Timeline (2026-10-16), confirmed with the user: Program Manager
// and Admin edit (import, save changes, add teams); Executive views only;
// every other role gets 403, logged-out 401 (JwtAuthGuard). Its own
// prefix - separate from the older Project Planning (/project-planning),
// whose PM-only edit rule is unchanged.
const VIEW_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN, UserRole.EXECUTIVE];
const EDIT_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER, UserRole.ADMIN];
// Resetting the slip baseline: Program Manager only (confirmed 2026-10-16).
const BASELINE_ROLES: UserRole[] = [UserRole.PROGRAM_MANAGER];

// The role check is a guard (not a check inside each handler) so it runs
// before the ValidationPipe: a Developer posting a malformed body gets 403,
// never a 400 that describes the body. Handlers read the checked user
// from req.timelineUser.
const TIMELINE_ROLES = 'projectTimelineRoles';
const Roles = (roles: UserRole[]) => SetMetadata(TIMELINE_ROLES, roles);

@Injectable()
class ProjectTimelineRolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.get<UserRole[]>(TIMELINE_ROLES, context.getHandler());
    const req = context.switchToHttp().getRequest();
    const user = await this.usersService.findById(req.user.sub);
    if (!roles.includes(user.role)) {
      throw new ForbiddenException(
        roles === BASELINE_ROLES
          ? 'Only a Program Manager can reset the Project Timeline baseline.'
          : roles === EDIT_ROLES
            ? 'Only a Program Manager or Admin can change the Project Timeline.'
            : 'Only Program Manager, Admin and Executive can view the Project Timeline.',
      );
    }
    req.timelineUser = user;
    return true;
  }
}

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

@Controller('project-timeline')
@UseGuards(JwtAuthGuard, ProjectTimelineRolesGuard)
export class ProjectTimelineController {
  constructor(private projectTimelineService: ProjectTimelineService) {}

  @Get('projects')
  @Roles(VIEW_ROLES)
  async projects(@Req() req: any) {
    return this.projectTimelineService.listProjects(req.user.tenantId);
  }

  @Get('projects/:projectId')
  @Roles(VIEW_ROLES)
  async plan(@Param('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    return this.projectTimelineService.getPlan(projectId, req.user.tenantId);
  }

  // Slip tracking: baselines from the audit log - read-only.
  @Get('projects/:projectId/slip')
  @Roles(VIEW_ROLES)
  async slip(@Param('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    return this.projectTimelineService.getSlip(projectId, req.user.tenantId);
  }

  @Post('projects/:projectId/baseline/reset')
  @Roles(BASELINE_ROLES)
  async resetBaseline(@Param('projectId', ParseIntPipe) projectId: number, @Body() dto: ResetTimelineBaselineDto, @Req() req: any) {
    return this.projectTimelineService.resetBaseline(projectId, dto.reason, req.timelineUser, req.user.tenantId);
  }

  // Stage B: dependencies ("starts after"). View roles read; PM/Admin
  // add, change the gap, remove - each audited.
  @Get('projects/:projectId/dependencies')
  @Roles(VIEW_ROLES)
  async dependencies(@Param('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    return this.projectTimelineService.listDependencies(projectId, req.user.tenantId);
  }

  @Post('projects/:projectId/dependencies')
  @Roles(EDIT_ROLES)
  async addDependency(@Param('projectId', ParseIntPipe) projectId: number, @Body() dto: CreateTimelineDependencyDto, @Req() req: any) {
    return this.projectTimelineService.addDependency(projectId, dto, req.timelineUser, req.user.tenantId);
  }

  @Patch('projects/:projectId/dependencies/:depId')
  @Roles(EDIT_ROLES)
  async updateDependency(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('depId', ParseIntPipe) depId: number,
    @Body() dto: UpdateTimelineDependencyDto,
    @Req() req: any,
  ) {
    return this.projectTimelineService.updateDependency(projectId, depId, dto.lagDays, req.timelineUser, req.user.tenantId);
  }

  @Delete('projects/:projectId/dependencies/:depId')
  @Roles(EDIT_ROLES)
  async removeDependency(@Param('projectId', ParseIntPipe) projectId: number, @Param('depId', ParseIntPipe) depId: number, @Req() req: any) {
    return this.projectTimelineService.removeDependency(projectId, depId, req.timelineUser, req.user.tenantId);
  }

  @Get('teams')
  @Roles(VIEW_ROLES)
  async teams(@Req() req: any) {
    return this.projectTimelineService.listTeams(req.user.tenantId);
  }

  @Post('teams')
  @Roles(EDIT_ROLES)
  async createTeam(@Body() dto: CreateTimelineTeamDto, @Req() req: any) {
    return this.projectTimelineService.createTeam(dto.name, req.timelineUser, req.user.tenantId);
  }

  @Get('template')
  @Roles(EDIT_ROLES)
  async template(@Query('format') format: string, @Res() res: Response) {
    if (format !== 'csv' && format !== 'xlsx') throw new BadRequestException('format must be "csv" or "xlsx".');
    const { buffer, filename } = await this.projectTimelineService.template(format);
    res.set({ 'Content-Type': CONTENT_TYPES[format], 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  // Reads the file - saves nothing.
  @Post('import/parse')
  @Roles(EDIT_ROLES)
  async parse(@Body() dto: ParseTimelineFileDto) {
    return this.projectTimelineService.parseFile(dto);
  }

  // Validates and diffs - saves nothing.
  @Post('projects/:projectId/import/preview')
  @Roles(EDIT_ROLES)
  async preview(@Param('projectId', ParseIntPipe) projectId: number, @Body() dto: PreviewTimelineImportDto, @Req() req: any) {
    return this.projectTimelineService.preview(projectId, dto, req.user.tenantId);
  }

  @Post('projects/:projectId/import')
  @Roles(EDIT_ROLES)
  async import(@Param('projectId', ParseIntPipe) projectId: number, @Body() dto: ApplyTimelineImportDto, @Req() req: any) {
    return this.projectTimelineService.applyImport(projectId, dto, req.timelineUser, req.user.tenantId);
  }

  // PM/Admin only (user decision 2026-10-16) - Executive views, no export.
  @Post('projects/:projectId/export')
  @HttpCode(200)
  @Roles(EDIT_ROLES)
  async export(@Param('projectId', ParseIntPipe) projectId: number, @Body() dto: ExportTimelineDto, @Req() req: any, @Res() res: Response) {
    const { buffer, filename } = await this.projectTimelineService.exportPlan(projectId, dto, req.user.tenantId);
    res.set({ 'Content-Type': CONTENT_TYPES[dto.format], 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  @Post('projects/:projectId/changes')
  @Roles(EDIT_ROLES)
  async saveChanges(@Param('projectId', ParseIntPipe) projectId: number, @Body() dto: SaveTimelineChangesDto, @Req() req: any) {
    return this.projectTimelineService.saveChanges(projectId, dto, req.timelineUser, req.user.tenantId);
  }
}
