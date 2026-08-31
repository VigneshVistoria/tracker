import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ModulesService } from './modules.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Viewing modules (and the drill-down overview) is open to anyone with
// access to the parent project - same check ProjectsController.findOne
// uses. Creating/editing/deleting modules is admin-only, consistent with
// how Projects and Sprints are managed today.
//
// The /projects/:id/... overview routes live here rather than on
// ProjectsController deliberately: this controller needs ModulesService,
// which itself depends on ProjectsService - putting the overview routes
// on ProjectsController instead would need ProjectsModule to import
// ModulesModule right back, a circular module dependency. No @Controller
// prefix below since routes span both /modules and /projects/:id/....
@Controller()
@UseGuards(JwtAuthGuard)
export class ModulesController {
  constructor(
    private modulesService: ModulesService,
    private usersService: UsersService,
  ) {}

  private async assertProjectAccess(projectId: number, req: any): Promise<void> {
    const currentUser = await this.usersService.findById(req.user.sub);
    // Admins, Executives, and Program Managers get leadership-wide
    // visibility regardless of project assignment - same convention as
    // ProjectsController and the Dependency Log.
    if (
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.EXECUTIVE ||
      currentUser.role === UserRole.PROGRAM_MANAGER
    ) {
      return;
    }
    const assignedProjectIds = (currentUser.projects || []).map((p) => p.id);
    if (!assignedProjectIds.includes(projectId)) {
      throw new ForbiddenException('You do not have access to this project');
    }
  }

  @Get('modules')
  async findAllForProject(@Query('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    await this.assertProjectAccess(projectId, req);
    return this.modulesService.findAllForProject(projectId, req.user.tenantId);
  }

  @Get('projects/:id/overview')
  async getProjectOverview(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertProjectAccess(id, req);
    return this.modulesService.getProjectOverview(id, req.user.tenantId);
  }

  @Get('projects/:id/modules/unassigned')
  async getUnassignedOverview(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertProjectAccess(id, req);
    return this.modulesService.getUnassignedOverview(id, req.user.tenantId);
  }

  @Get('modules/:id/overview')
  async getModuleOverview(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const module = await this.modulesService.findOne(id, req.user.tenantId);
    await this.assertProjectAccess(module.projectId, req);
    return this.modulesService.getModuleOverview(id, req.user.tenantId);
  }

  @Post('modules')
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateModuleDto, @Req() req: any) {
    return this.modulesService.create(dto, req.user.sub, req.user.tenantId);
  }

  @Patch('modules/:id')
  @UseGuards(AdminGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateModuleDto, @Req() req: any) {
    return this.modulesService.update(id, dto, req.user.tenantId);
  }

  @Delete('modules/:id')
  @UseGuards(AdminGuard)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.modulesService.remove(id, req.user.tenantId);
  }
}
