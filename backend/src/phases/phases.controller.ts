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
import { PhasesService } from './phases.service';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { ModulesService } from '../modules/modules.service';

// Brand-new entity, no legacy capability to protect (unlike Modules,
// which widened an existing admin-only feature) - so this follows the
// Project Planning precedent instead: manage is Program Manager only,
// exactly as requested. View is Admin/Executive/PM, same as every
// module built today.
@Controller('phases')
@UseGuards(JwtAuthGuard)
export class PhasesController {
  constructor(
    private phasesService: PhasesService,
    private modulesService: ModulesService,
    private usersService: UsersService,
  ) {}

  // Tenant-wide view, for the Project Phases admin page only - stricter
  // than assertModuleAccess below on purpose, since that page manages
  // every phase across every project regardless of assignment.
  private async assertCanView(userId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.EXECUTIVE &&
      currentUser.role !== UserRole.PROGRAM_MANAGER
    ) {
      throw new ForbiddenException('Only Admin, Executive, and Program Manager can view Phases.');
    }
  }

  // Module-scoped view, for the ticket-creation cascading Project/Module/
  // Phase pickers (Issue edit form, Project Planning, Task Backlog,
  // Create Defect) - same rule ModulesController.assertProjectAccess
  // already uses for its own module-listing endpoint: leadership-wide
  // roles see everything, everyone else only phases in a project they're
  // assigned to. Previously this used the stricter assertCanView above
  // (Admin/Executive/Program Manager only), which silently 403'd QA/
  // Developer/Client here even though those same roles already have
  // project-scoped access to Projects and Modules - the mismatch left
  // every Phase dropdown empty for them (findAllForModule() below never
  // threw visibly since every caller catches the error and falls back to
  // an empty list, so it looked like "no phases exist" instead of "no
  // access").
  private async assertModuleAccess(moduleId: number, userId: number, tenantId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.EXECUTIVE ||
      currentUser.role === UserRole.PROGRAM_MANAGER
    ) {
      return;
    }
    const module = await this.modulesService.findOne(moduleId, tenantId);
    const assignedProjectIds = (currentUser.projects || []).map((p) => p.id);
    if (!assignedProjectIds.includes(module.projectId)) {
      throw new ForbiddenException('You do not have access to this project');
    }
  }

  private async assertCanManage(userId: number): Promise<{ id: number; email: string }> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Program Manager can manage phases.');
    }
    return { id: currentUser.id, email: currentUser.email };
  }

  // Rename-only widening of assertCanManage above, used solely by the
  // PATCH :id route below - Admin gets the ability to rename a Phase
  // (2026-09 inline-edit-name feature, matching the same ability on
  // Issue Categories), but not to create/deactivate/activate/delete one,
  // which stay Program Manager only exactly as originally scoped.
  // UpdatePhaseDto only ever carries `name`, so there's no other field
  // this could let Admin change.
  private async assertCanRename(userId: number): Promise<{ id: number; email: string }> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.PROGRAM_MANAGER && currentUser.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only Admin or Program Manager can rename phases.');
    }
    return { id: currentUser.id, email: currentUser.email };
  }

  // Module-scoped search-select, used by Project Planning, the Issue
  // create/edit forms, Task Backlog, and Create Defect - active only by
  // default.
  @Get()
  async findAllForModule(@Query('moduleId', ParseIntPipe) moduleId: number, @Req() req: any) {
    await this.assertModuleAccess(moduleId, req.user.sub, req.user.tenantId);
    return this.phasesService.findAllForModule(moduleId, req.user.tenantId);
  }

  // Tenant-wide list with %Complete, across every project/module -
  // powers the Project Phases page.
  @Get('all')
  async findAllWithCompletion(
    @Query('projectId') projectId: string | undefined,
    @Query('moduleId') moduleId: string | undefined,
    @Req() req: any,
  ) {
    await this.assertCanView(req.user.sub);
    return this.phasesService.findAllWithCompletion(req.user.tenantId, {
      projectId: projectId !== undefined ? Number(projectId) : undefined,
      moduleId: moduleId !== undefined ? Number(moduleId) : undefined,
    });
  }

  @Post()
  async create(@Body() dto: CreatePhaseDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.phasesService.create(dto, user, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePhaseDto, @Req() req: any) {
    const user = await this.assertCanRename(req.user.sub);
    return this.phasesService.update(id, dto, user, req.user.tenantId);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.phasesService.setActive(id, false, user, req.user.tenantId);
  }

  @Patch(':id/activate')
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.phasesService.setActive(id, true, user, req.user.tenantId);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    await this.phasesService.remove(id, user, req.user.tenantId);
    return { success: true };
  }
}
