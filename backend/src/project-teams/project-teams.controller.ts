import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ProjectTeamsService } from './project-teams.service';
import { CreateProjectTeamDto } from './dto/create-project-team.dto';
import { UpdateProjectTeamDto } from './dto/update-project-team.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Same visibility rule as Project Planning/Phases: view is Admin/
// Executive/Program Manager only, create/edit/status-change is Program
// Manager only - narrower than Module's Admin+PM, matching the task's
// explicit requirement.
@Controller('project-teams')
@UseGuards(JwtAuthGuard)
export class ProjectTeamsController {
  constructor(
    private projectTeamsService: ProjectTeamsService,
    private usersService: UsersService,
  ) {}

  private async assertCanView(userId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.EXECUTIVE &&
      currentUser.role !== UserRole.PROGRAM_MANAGER
    ) {
      throw new ForbiddenException('Only Admin, Executive, and Program Manager can view Teams.');
    }
  }

  private async assertCanManage(userId: number): Promise<{ id: number; email: string }> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Program Manager can manage Teams.');
    }
    return { id: currentUser.id, email: currentUser.email };
  }

  // Project-scoped search-select, used by Project Planning (and this
  // module's own create form) - Active only by default.
  @Get()
  async findAllForProject(@Query('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    await this.assertCanView(req.user.sub);
    return this.projectTeamsService.findAllForProject(projectId, req.user.tenantId);
  }

  // Tenant-wide list including Inactive, optionally filtered by Project -
  // powers the Project Teams list page.
  @Get('all')
  async findAllWithStatus(@Query('projectId') projectId: string | undefined, @Req() req: any) {
    await this.assertCanView(req.user.sub);
    const parsedProjectId = projectId !== undefined ? Number(projectId) : undefined;
    return this.projectTeamsService.findAllWithStatus(req.user.tenantId, parsedProjectId);
  }

  @Post()
  async create(@Body() dto: CreateProjectTeamDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.projectTeamsService.create(dto, user, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectTeamDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.projectTeamsService.update(id, dto, user, req.user.tenantId);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.projectTeamsService.setStatus(id, 'Inactive', user, req.user.tenantId);
  }

  @Patch(':id/activate')
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.projectTeamsService.setStatus(id, 'Active', user, req.user.tenantId);
  }
}
