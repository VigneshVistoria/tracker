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
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Viewing modules (and the drill-down overview) is open to anyone with
// access to the parent project - same check ProjectsController.findOne
// uses. Creating/editing/deleting modules is Admin+Program Manager -
// widened from admin-only so PM actually gets write access (the whole
// point of the Project Module Creation task), same convention as
// Categories/Teams/Labels.
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

  // Tenant-wide view, same role boundary as Project Planning's
  // assertCanView - QA/Developer/Client get 403, not a filtered response.
  private async assertCanView(userId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.EXECUTIVE &&
      currentUser.role !== UserRole.PROGRAM_MANAGER
    ) {
      throw new ForbiddenException('Only Admin, Executive, and Program Manager can view all Modules.');
    }
  }

  private async assertCanManage(userId: number): Promise<{ id: number; email: string }> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Admin or Program Manager can manage modules.');
    }
    return { id: currentUser.id, email: currentUser.email };
  }

  @Get('modules')
  async findAllForProject(@Query('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    await this.assertProjectAccess(projectId, req);
    return this.modulesService.findAllForProject(projectId, req.user.tenantId);
  }

  // Tenant-wide list with %Complete, across every project - powers the
  // Project Modules page. Separate from the route above so that route's
  // existing dropdown consumers (Issue edit form, Project Planning) are
  // never touched by this change.
  @Get('modules/all')
  async findAllWithCompletion(@Query('projectId') projectId: string | undefined, @Req() req: any) {
    await this.assertCanView(req.user.sub);
    const parsedProjectId = projectId !== undefined ? Number(projectId) : undefined;
    return this.modulesService.findAllWithCompletion(req.user.tenantId, parsedProjectId);
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
  async create(@Body() dto: CreateModuleDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.modulesService.create(dto, user, req.user.tenantId);
  }

  @Patch('modules/:id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateModuleDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.modulesService.update(id, dto, user, req.user.tenantId);
  }

  @Patch('modules/:id/deactivate')
  async deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.modulesService.setActive(id, false, user, req.user.tenantId);
  }

  @Patch('modules/:id/activate')
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.modulesService.setActive(id, true, user, req.user.tenantId);
  }

  @Delete('modules/:id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    await this.modulesService.remove(id, user, req.user.tenantId);
    return { success: true };
  }
}
